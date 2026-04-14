from __future__ import annotations

import hashlib
import json
import os
import secrets
import sqlite3
from datetime import UTC, datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlparse


BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "noters.db"
PLATFORM_FEE_RATE = 0.5 # 5% platform fee on each transaction
PLATFORM_UPI_ID = os.environ.get("PLATFORM_UPI_ID", "noters@upi")
PLATFORM_UPI_NAME = os.environ.get("PLATFORM_UPI_NAME", "Noters Marketplace")
SESSIONS: dict[str, int] = {}


def get_connection() -> sqlite3.Connection:
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def hash_password(password: str, salt: str | None = None) -> tuple[str, str]:
    salt = salt or os.urandom(16).hex()
    hashed = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        bytes.fromhex(salt),
        100_000,
    ).hex()
    return hashed, salt


def verify_password(password: str, salt: str, expected_hash: str) -> bool:
    hashed, _ = hash_password(password, salt)
    return hashed == expected_hash


def round_money(value: float) -> float:
    return round(float(value), 2)


def create_session(user_id: int) -> str:
    token = secrets.token_hex(24)
    SESSIONS[token] = user_id
    return token


def build_upi_link(amount: float, transaction_ref: str, listing_title: str) -> str:
    params = urlencode(
        {
            "pa": PLATFORM_UPI_ID,
            "pn": PLATFORM_UPI_NAME,
            "am": f"{amount:.2f}",
            "cu": "INR",
            "tn": f"Noters purchase - {listing_title}",
            "tr": transaction_ref,
        }
    )
    return f"upi://pay?{params}"


def serialize_user(user: sqlite3.Row) -> dict:
    return {
        "id": user["id"],
        "name": user["name"],
        "email": user["email"],
        "role": user["role"],
    }


def serialize_material(material: sqlite3.Row) -> dict:
    price = round_money(material["price"])
    platform_fee = round_money(price * PLATFORM_FEE_RATE)
    seller_earnings = round_money(price - platform_fee)
    created_at = datetime.fromisoformat(material["created_at"])

    return {
        "id": material["id"],
        "title": material["title"],
        "category": material["category"],
        "description": material["description"],
        "price": price,
        "platform_fee": platform_fee,
        "seller_earnings": seller_earnings,
        "seller_name": material["seller_name"],
        "payment_method": "UPI only",
        "role_label": "seller listing",
        "created_label": f"Listed {created_at.strftime('%d %b %Y')}",
    }


def serialize_order(order: sqlite3.Row) -> dict:
    created_at = datetime.fromisoformat(order["created_at"])
    paid_at = datetime.fromisoformat(order["paid_at"]) if order["paid_at"] else None

    return {
        "id": order["id"],
        "material_id": order["material_id"],
        "listing_title": order["listing_title"],
        "amount": round_money(order["amount"]),
        "platform_fee": round_money(order["platform_fee"]),
        "seller_earnings": round_money(order["seller_earnings"]),
        "upi_id": order["upi_id"],
        "transaction_ref": order["transaction_ref"],
        "payment_reference": order["payment_reference"],
        "status": order["status"],
        "created_label": f"Created {created_at.strftime('%d %b %Y %I:%M %p')}",
        "paid_label": f"Paid {paid_at.strftime('%d %b %Y %I:%M %p')}" if paid_at else "Awaiting payment",
    }


def init_db() -> None:
    connection = get_connection()
    cursor = connection.cursor()

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            salt TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('buyer', 'seller')),
            created_at TEXT NOT NULL
        )
        """
    )

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS materials (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            category TEXT NOT NULL,
            description TEXT NOT NULL,
            price REAL NOT NULL,
            seller_name TEXT NOT NULL,
            seller_id INTEGER,
            created_at TEXT NOT NULL,
            FOREIGN KEY (seller_id) REFERENCES users(id)
        )
        """
    )

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            material_id INTEGER NOT NULL,
            buyer_id INTEGER NOT NULL,
            buyer_name TEXT NOT NULL,
            listing_title TEXT NOT NULL,
            amount REAL NOT NULL,
            platform_fee REAL NOT NULL,
            seller_earnings REAL NOT NULL,
            upi_id TEXT NOT NULL,
            transaction_ref TEXT NOT NULL,
            payment_reference TEXT,
            status TEXT NOT NULL CHECK(status IN ('pending', 'paid')),
            created_at TEXT NOT NULL,
            paid_at TEXT,
            FOREIGN KEY (material_id) REFERENCES materials(id),
            FOREIGN KEY (buyer_id) REFERENCES users(id)
        )
        """
    )

    connection.commit()
    connection.close()


class NotersHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(BASE_DIR), **kwargs)

    def end_headers(self) -> None:
        origin = self.headers.get("Origin")
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        else:
            self.send_header("Access-Control-Allow-Origin", "*")

        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        super().end_headers()

    def do_GET(self) -> None:
        parsed = urlparse(self.path)

        if parsed.path == "/api/materials":
            self.handle_get_materials(parsed)
            return

        if parsed.path == "/api/orders":
            self.handle_get_orders()
            return

        if parsed.path == "/":
            self.path = "/index.html"

        super().do_GET()

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.end_headers()

    def do_POST(self) -> None:
        parsed = urlparse(self.path)

        if parsed.path == "/api/signup":
            self.handle_signup()
            return

        if parsed.path == "/api/login":
            self.handle_login()
            return

        if parsed.path == "/api/materials":
            self.handle_create_material()
            return

        if parsed.path == "/api/orders":
            self.handle_create_order()
            return

        if parsed.path == "/api/orders/confirm":
            self.handle_confirm_order()
            return

        if parsed.path == "/api/logout":
            self.handle_logout()
            return

        self.send_json({"error": "Route not found."}, status=404)

    def read_json(self) -> dict:
        content_length = int(self.headers.get("Content-Length", "0"))
        raw_body = self.rfile.read(content_length) if content_length else b"{}"
        try:
            return json.loads(raw_body.decode("utf-8"))
        except json.JSONDecodeError as error:
            raise ValueError("Invalid JSON body.") from error

    def send_json(self, payload: dict, status: int = 200) -> None:
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def get_authenticated_user(self) -> sqlite3.Row | None:
        authorization = self.headers.get("Authorization", "")
        if not authorization.startswith("Bearer "):
            return None

        token = authorization.removeprefix("Bearer ").strip()
        user_id = SESSIONS.get(token)
        if not user_id:
            return None

        connection = get_connection()
        user = connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        connection.close()
        return user

    def handle_signup(self) -> None:
        try:
            payload = self.read_json()
        except ValueError as error:
            self.send_json({"error": str(error)}, status=400)
            return

        name = str(payload.get("name", "")).strip()
        email = str(payload.get("email", "")).strip().lower()
        password = str(payload.get("password", ""))
        role = str(payload.get("role", "")).strip().lower()

        if not name:
            self.send_json({"error": "Full name is required."}, status=400)
            return
        if "@" not in email:
            self.send_json({"error": "A valid email is required."}, status=400)
            return
        if len(password) < 6:
            self.send_json({"error": "Password must be at least 6 characters."}, status=400)
            return
        if role not in {"buyer", "seller"}:
            self.send_json({"error": "Role must be buyer or seller."}, status=400)
            return

        password_hash, salt = hash_password(password)
        created_at = datetime.now(UTC).isoformat()

        connection = get_connection()
        cursor = connection.cursor()

        try:
            cursor.execute(
                """
                INSERT INTO users (name, email, password_hash, salt, role, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (name, email, password_hash, salt, role, created_at),
            )
            connection.commit()
        except sqlite3.IntegrityError:
            connection.close()
            self.send_json({"error": "This email is already registered."}, status=409)
            return

        user = cursor.execute("SELECT * FROM users WHERE id = ?", (cursor.lastrowid,)).fetchone()
        connection.close()
        token = create_session(user["id"])
        self.send_json(
            {"message": "Account created.", "user": serialize_user(user), "token": token},
            status=201,
        )

    def handle_login(self) -> None:
        try:
            payload = self.read_json()
        except ValueError as error:
            self.send_json({"error": str(error)}, status=400)
            return

        email = str(payload.get("email", "")).strip().lower()
        password = str(payload.get("password", ""))
        role = str(payload.get("role", "")).strip().lower()

        connection = get_connection()
        user = connection.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
        connection.close()

        if user is None or not verify_password(password, user["salt"], user["password_hash"]):
            self.send_json({"error": "Incorrect email or password."}, status=401)
            return

        if role and role in {"buyer", "seller"} and user["role"] != role:
            self.send_json(
                {"error": f"This account is registered as a {user['role']}, not a {role}."},
                status=403,
            )
            return

        token = create_session(user["id"])
        self.send_json({"message": "Logged in.", "user": serialize_user(user), "token": token})

    def handle_get_materials(self, parsed) -> None:
        query = parse_qs(parsed.query).get("q", [""])[0].strip().lower()
        search_term = f"%{query}%"

        connection = get_connection()
        if query:
            rows = connection.execute(
                """
                SELECT *
                FROM materials
                WHERE LOWER(title) LIKE ?
                   OR LOWER(category) LIKE ?
                   OR LOWER(description) LIKE ?
                   OR LOWER(seller_name) LIKE ?
                ORDER BY id DESC
                """,
                (search_term, search_term, search_term, search_term),
            ).fetchall()
        else:
            rows = connection.execute("SELECT * FROM materials ORDER BY id DESC").fetchall()
        connection.close()

        self.send_json({"materials": [serialize_material(row) for row in rows]})

    def handle_create_material(self) -> None:
        try:
            payload = self.read_json()
        except ValueError as error:
            self.send_json({"error": str(error)}, status=400)
            return

        seller = self.get_authenticated_user()
        if seller is None:
            self.send_json({"error": "Please log in as a seller first."}, status=401)
            return
        if seller["role"] != "seller":
            self.send_json({"error": "Only seller accounts can create listings."}, status=403)
            return

        title = str(payload.get("title", "")).strip()
        category = str(payload.get("category", "")).strip()
        description = str(payload.get("description", "")).strip()

        try:
            price = round_money(float(payload.get("price", 0)))
        except (TypeError, ValueError):
            self.send_json({"error": "Price must be a number."}, status=400)
            return

        if not title or not category or not description:
            self.send_json({"error": "All listing fields are required."}, status=400)
            return
        if price <= 0:
            self.send_json({"error": "Price must be greater than zero."}, status=400)
            return

        connection = get_connection()
        created_at = datetime.now(UTC).isoformat()
        cursor = connection.cursor()
        cursor.execute(
            """
            INSERT INTO materials (title, category, description, price, seller_name, seller_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (title, category, description, price, seller["name"], seller["id"], created_at),
        )
        connection.commit()
        material = connection.execute("SELECT * FROM materials WHERE id = ?", (cursor.lastrowid,)).fetchone()
        connection.close()

        self.send_json({"message": "Listing created.", "material": serialize_material(material)}, status=201)

    def handle_create_order(self) -> None:
        try:
            payload = self.read_json()
        except ValueError as error:
            self.send_json({"error": str(error)}, status=400)
            return

        buyer = self.get_authenticated_user()
        if buyer is None:
            self.send_json({"error": "Please log in as a buyer first."}, status=401)
            return
        if buyer["role"] != "buyer":
            self.send_json({"error": "Only buyer accounts can start UPI payments."}, status=403)
            return

        try:
            material_id = int(payload.get("material_id", 0))
        except (TypeError, ValueError):
            self.send_json({"error": "A valid listing is required."}, status=400)
            return

        connection = get_connection()
        material = connection.execute("SELECT * FROM materials WHERE id = ?", (material_id,)).fetchone()
        if material is None:
            connection.close()
            self.send_json({"error": "Listing not found."}, status=404)
            return

        amount = round_money(material["price"])
        platform_fee = round_money(amount * PLATFORM_FEE_RATE)
        seller_earnings = round_money(amount - platform_fee)
        transaction_ref = f"NOTERS{datetime.now(UTC).strftime('%Y%m%d%H%M%S')}{secrets.token_hex(3).upper()}"
        created_at = datetime.now(UTC).isoformat()

        cursor = connection.cursor()
        cursor.execute(
            """
            INSERT INTO orders (
                material_id,
                buyer_id,
                buyer_name,
                listing_title,
                amount,
                platform_fee,
                seller_earnings,
                upi_id,
                transaction_ref,
                payment_reference,
                status,
                created_at,
                paid_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                material["id"],
                buyer["id"],
                buyer["name"],
                material["title"],
                amount,
                platform_fee,
                seller_earnings,
                PLATFORM_UPI_ID,
                transaction_ref,
                None,
                "pending",
                created_at,
                None,
            ),
        )
        connection.commit()
        order = connection.execute("SELECT * FROM orders WHERE id = ?", (cursor.lastrowid,)).fetchone()
        connection.close()

        self.send_json(
            {
                "message": "UPI order created.",
                "order": serialize_order(order),
                "platform_upi_id": PLATFORM_UPI_ID,
                "platform_upi_name": PLATFORM_UPI_NAME,
                "upi_link": build_upi_link(amount, transaction_ref, material["title"]),
            },
            status=201,
        )

    def handle_confirm_order(self) -> None:
        try:
            payload = self.read_json()
        except ValueError as error:
            self.send_json({"error": str(error)}, status=400)
            return

        buyer = self.get_authenticated_user()
        if buyer is None:
            self.send_json({"error": "Please log in as a buyer first."}, status=401)
            return
        if buyer["role"] != "buyer":
            self.send_json({"error": "Only buyer accounts can confirm UPI payments."}, status=403)
            return

        try:
            order_id = int(payload.get("order_id", 0))
        except (TypeError, ValueError):
            self.send_json({"error": "A valid order is required."}, status=400)
            return

        payment_reference = str(payload.get("payment_reference", "")).strip()
        if not payment_reference:
            self.send_json({"error": "UPI transaction reference is required."}, status=400)
            return

        connection = get_connection()
        order = connection.execute(
            "SELECT * FROM orders WHERE id = ? AND buyer_id = ?",
            (order_id, buyer["id"]),
        ).fetchone()

        if order is None:
            connection.close()
            self.send_json({"error": "Order not found."}, status=404)
            return

        if order["status"] == "paid":
            connection.close()
            self.send_json({"error": "This order is already marked as paid."}, status=409)
            return

        paid_at = datetime.now(UTC).isoformat()
        connection.execute(
            """
            UPDATE orders
            SET payment_reference = ?, status = 'paid', paid_at = ?
            WHERE id = ?
            """,
            (payment_reference, paid_at, order_id),
        )
        connection.commit()
        updated_order = connection.execute("SELECT * FROM orders WHERE id = ?", (order_id,)).fetchone()
        connection.close()

        self.send_json({"message": "Payment confirmed.", "order": serialize_order(updated_order)})

    def handle_get_orders(self) -> None:
        user = self.get_authenticated_user()
        if user is None:
            self.send_json({"error": "Please log in first."}, status=401)
            return

        connection = get_connection()
        if user["role"] == "buyer":
            rows = connection.execute(
                "SELECT * FROM orders WHERE buyer_id = ? ORDER BY id DESC",
                (user["id"],),
            ).fetchall()
        else:
            rows = connection.execute(
                "SELECT * FROM orders ORDER BY id DESC"
            ).fetchall()
        connection.close()

        self.send_json({"orders": [serialize_order(row) for row in rows]})

    def handle_logout(self) -> None:
        authorization = self.headers.get("Authorization", "")
        if authorization.startswith("Bearer "):
            token = authorization.removeprefix("Bearer ").strip()
            SESSIONS.pop(token, None)
        self.send_json({"message": "Logged out."})


def run() -> None:
    init_db()
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "8000"))
    server = ThreadingHTTPServer((host, port), NotersHandler)
    print(f"Noters server running at http://{host}:{port}")
    server.serve_forever()


if __name__ == "__main__":
    run()
