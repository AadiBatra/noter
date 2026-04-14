const state = {
    authMode: "signup",
    authRole: "buyer",
    user: loadSavedUser(),
    materials: [],
    query: "",
    pendingPurchaseMaterialId: null,
    activeOrder: null
};

const API_BASE = resolveApiBase();

const currencyFormatter = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR"
});

const authModal = document.getElementById("auth-modal");
const authTitle = document.getElementById("auth-title");
const authSubtitle = document.getElementById("auth-subtitle");
const authForm = document.getElementById("auth-form");
const authName = document.getElementById("auth-name");
const authEmail = document.getElementById("auth-email");
const authPassword = document.getElementById("auth-password");
const authSubmit = document.getElementById("auth-submit");
const authMessage = document.getElementById("auth-message");
const nameField = document.getElementById("name-field");

const paymentModal = document.getElementById("payment-modal");
const paymentTitle = document.getElementById("payment-title");
const paymentSubtitle = document.getElementById("payment-subtitle");
const paymentListingTitle = document.getElementById("payment-listing-title");
const paymentTotalAmount = document.getElementById("payment-total-amount");
const paymentSellerShare = document.getElementById("payment-seller-share");
const paymentPlatformFee = document.getElementById("payment-platform-fee");
const paymentUpiId = document.getElementById("payment-upi-id");
const paymentOrderReference = document.getElementById("payment-order-reference");
const paymentOpenUpi = document.getElementById("payment-open-upi");
const paymentForm = document.getElementById("payment-form");
const paymentReferenceInput = document.getElementById("payment-reference");
const paymentMessage = document.getElementById("payment-message");

const sessionTitle = document.getElementById("session-title");
const sessionCopy = document.getElementById("session-copy");
const logoutButton = document.getElementById("logout-button");
const guestOnlyActions = document.querySelectorAll("[data-guest-only]");

const searchForm = document.getElementById("search-form");
const searchInput = document.getElementById("study-search");
const searchFeedback = document.getElementById("search-feedback");
const resultSummary = document.getElementById("result-summary");
const materialsGrid = document.getElementById("materials-grid");
const emptyState = document.getElementById("empty-state");

const listingForm = document.getElementById("listing-form");
const listingPriceInput = document.getElementById("listing-price");
const listingMessage = document.getElementById("listing-message");
const previewSellerShare = document.getElementById("preview-seller-share");
const previewPlatformShare = document.getElementById("preview-platform-share");
const listingSubmitButton = listingForm.querySelector("button[type='submit']");

let searchTimer;

function loadSavedUser() {
    try {
        const saved = localStorage.getItem("notersUser");
        return saved ? JSON.parse(saved) : null;
    } catch (error) {
        return null;
    }
}

function resolveApiBase() {
    if (window.location.protocol === "file:") {
        return "http://127.0.0.1:8000";
    }

    const currentOrigin = window.location.origin;
    if (/127\.0\.0\.1:8000|localhost:8000/.test(currentOrigin)) {
        return "";
    }

    return "http://127.0.0.1:8000";
}

function saveUser(user) {
    state.user = user;
    if (user) {
        localStorage.setItem("notersUser", JSON.stringify(user));
    } else {
        localStorage.removeItem("notersUser");
    }
}

function formatCurrency(value) {
    return currencyFormatter.format(Number(value || 0));
}

function apiUrl(path) {
    return `${API_BASE}${path}`;
}

function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function setMessage(element, text, tone = "") {
    element.textContent = text;
    element.classList.remove("success", "error");
    if (tone) {
        element.classList.add(tone);
    }
}

function hasSession() {
    return Boolean(state.user && state.user.token);
}

function isSeller() {
    return hasSession() && state.user.role === "seller";
}

function isBuyer() {
    return hasSession() && state.user.role === "buyer";
}

function setAuthMode(mode) {
    state.authMode = mode;

    document.querySelectorAll("[data-mode-toggle]").forEach((button) => {
        button.classList.toggle("active", button.dataset.modeToggle === mode);
    });

    const isSignup = mode === "signup";
    nameField.classList.toggle("hidden", !isSignup);
    authName.required = isSignup;
    authTitle.textContent = isSignup ? "Create your account" : "Welcome back";
    authSubtitle.textContent = isSignup
        ? "Choose whether you want to join as a buyer or seller."
        : "Log in to continue searching, paying with UPI, or selling on Noters.";
    authSubmit.textContent = isSignup ? "Create account" : "Log in";
    setMessage(authMessage, "");
}

function setAuthRole(role) {
    state.authRole = role;

    document.querySelectorAll("[data-role-toggle]").forEach((button) => {
        button.classList.toggle("active", button.dataset.roleToggle === role);
    });
}

function openAuthModal(mode = "signup", role = "buyer") {
    setAuthMode(mode);
    setAuthRole(role);
    authModal.classList.remove("hidden");
    authModal.setAttribute("aria-hidden", "false");
}

function closeAuthModal() {
    authModal.classList.add("hidden");
    authModal.setAttribute("aria-hidden", "true");
}

function getMaterialById(materialId) {
    return state.materials.find((material) => String(material.id) === String(materialId)) || null;
}

function resetPaymentModal() {
    state.activeOrder = null;
    paymentTitle.textContent = "Complete your payment";
    paymentSubtitle.textContent = "Noters accepts only UPI payments. The 5% platform fee is included in the listing total below.";
    paymentListingTitle.textContent = "Choose a listing";
    paymentTotalAmount.textContent = formatCurrency(0);
    paymentSellerShare.textContent = formatCurrency(0);
    paymentPlatformFee.textContent = formatCurrency(0);
    paymentUpiId.textContent = "noters@upi";
    paymentOrderReference.textContent = "Transaction reference will appear here.";
    paymentOpenUpi.classList.add("hidden");
    paymentOpenUpi.removeAttribute("href");
    paymentForm.classList.add("hidden");
    paymentReferenceInput.value = "";
    setMessage(paymentMessage, "");
}

function fillPaymentPreview(material) {
    paymentTitle.textContent = "Pay with UPI";
    paymentSubtitle.textContent = "Only UPI payments are available. The total already includes the 5% platform fee.";
    paymentListingTitle.textContent = material.title;
    paymentTotalAmount.textContent = formatCurrency(material.price);
    paymentSellerShare.textContent = formatCurrency(material.seller_earnings);
    paymentPlatformFee.textContent = formatCurrency(material.platform_fee);
}

function openPaymentModal(material) {
    resetPaymentModal();
    fillPaymentPreview(material);
    paymentModal.classList.remove("hidden");
    paymentModal.setAttribute("aria-hidden", "false");
}

function closePaymentModal() {
    paymentModal.classList.add("hidden");
    paymentModal.setAttribute("aria-hidden", "true");
    resetPaymentModal();
}

function getBuyButtonLabel() {
    if (isBuyer()) {
        return "Pay with UPI";
    }

    if (hasSession()) {
        return "Buyer account required";
    }

    return "Log in to buy";
}

function updateSessionUI() {
    guestOnlyActions.forEach((element) => {
        element.classList.toggle("hidden", hasSession());
    });

    if (hasSession()) {
        sessionTitle.textContent = `${state.user.name} is logged in as a ${state.user.role}`;
        sessionCopy.textContent = state.user.role === "seller"
            ? "You can publish new listings below. Buyers pay by UPI, sellers keep 95%, and the platform keeps 5%."
            : "You can search the marketplace and pay using UPI only. Each payment includes the 5% platform fee automatically.";
        logoutButton.classList.remove("hidden");
    } else {
        sessionTitle.textContent = "Browsing as guest";
        sessionCopy.textContent = "Create a buyer or seller account to unlock UPI checkout, role-based actions, and seller tools.";
        logoutButton.classList.add("hidden");
    }

    if (isSeller()) {
        listingSubmitButton.textContent = "Publish listing";
        setMessage(listingMessage, "Seller access enabled. Publish a new note whenever you are ready.", "success");
    } else {
        listingSubmitButton.textContent = "Log in as seller to publish";
        setMessage(listingMessage, "Seller access is required to create a listing.", "error");
    }
}

function renderMaterials() {
    if (!state.materials.length) {
        materialsGrid.innerHTML = "";
        emptyState.classList.remove("hidden");
        resultSummary.textContent = state.query
            ? `No results for "${state.query}".`
            : "No listings are available yet.";
        return;
    }

    emptyState.classList.add("hidden");
    resultSummary.textContent = state.query
        ? `Showing ${state.materials.length} result${state.materials.length === 1 ? "" : "s"} for "${state.query}".`
        : `Showing ${state.materials.length} live listing${state.materials.length === 1 ? "" : "s"}.`;

    const buyButtonLabel = getBuyButtonLabel();

    materialsGrid.innerHTML = state.materials.map((material) => `
        <article class="material-card">
            <div class="material-card-header">
                <span class="role-badge">${escapeHtml(material.category)}</span>
                <span class="meta-chip">${escapeHtml(material.seller_name)}</span>
            </div>

            <div>
                <h3>${escapeHtml(material.title)}</h3>
                <p>${escapeHtml(material.description)}</p>
            </div>

            <div class="price-row">
                <span>Listing price</span>
                <strong>${formatCurrency(material.price)}</strong>
            </div>

            <div class="earnings-breakdown">
                <span>Seller earns</span>
                <strong>${formatCurrency(material.seller_earnings)}</strong>
                <span>Platform fee: ${formatCurrency(material.platform_fee)}</span>
            </div>

            <div class="material-actions">
                <div class="material-card-footer">
                    <div class="meta-row">
                        <span class="meta-chip">${escapeHtml(material.role_label)}</span>
                        <span class="meta-chip">UPI only</span>
                        <span class="meta-chip">5% fee active</span>
                    </div>
                    <span>${escapeHtml(material.created_label)}</span>
                </div>

                <button type="button" class="solid-button wide-button" data-buy-material="${material.id}">
                    ${buyButtonLabel}
                </button>
            </div>
        </article>
    `).join("");
}

async function fetchMaterials(query = "") {
    state.query = query.trim();
    const params = new URLSearchParams();
    if (state.query) {
        params.set("q", state.query);
    }

    const url = params.toString() ? apiUrl(`/api/materials?${params}`) : apiUrl("/api/materials");

    try {
        const response = await fetch(url);
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || "Unable to load listings.");
        }

        state.materials = data.materials || [];
        searchFeedback.textContent = state.query
            ? `Search is active. Backend results are filtered by "${state.query}".`
            : "Search is active and connected to the marketplace listings below.";
        renderMaterials();
    } catch (error) {
        state.materials = [];
        materialsGrid.innerHTML = "";
        emptyState.classList.remove("hidden");
        resultSummary.textContent = "Marketplace unavailable";
        searchFeedback.textContent = "The backend is not responding. Start the Python server to use login, UPI checkout, and search.";
    }
}

function updatePayoutPreview() {
    const price = Number(listingPriceInput.value || 0);
    const sellerShare = price * 0.95;
    const platformShare = price * 0.05;

    previewSellerShare.textContent = formatCurrency(sellerShare);
    previewPlatformShare.textContent = formatCurrency(platformShare);
}

async function handleAuthSubmit(event) {
    event.preventDefault();
    setMessage(authMessage, "Working on your request...");

    const payload = {
        email: authEmail.value.trim(),
        password: authPassword.value,
        role: state.authRole
    };

    if (state.authMode === "signup") {
        payload.name = authName.value.trim();
    }

    try {
        const response = await fetch(apiUrl(`/api/${state.authMode}`), {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || "Authentication failed.");
        }

        saveUser({
            ...data.user,
            token: data.token
        });
        updateSessionUI();
        renderMaterials();
        authForm.reset();
        setAuthMode(state.authMode);
        closeAuthModal();

        if (state.pendingPurchaseMaterialId && isBuyer()) {
            const materialId = state.pendingPurchaseMaterialId;
            state.pendingPurchaseMaterialId = null;
            await handleMaterialPurchase(materialId);
            return;
        }

        state.pendingPurchaseMaterialId = null;
        setMessage(listingMessage, `Welcome ${data.user.name}.`, "success");
    } catch (error) {
        setMessage(authMessage, error.message, "error");
    }
}

function promptBuyerLogin(message) {
    openAuthModal("login", "buyer");
    setMessage(authMessage, message, "error");
}

async function handleMaterialPurchase(materialId) {
    const material = getMaterialById(materialId);
    if (!material) {
        return;
    }

    state.pendingPurchaseMaterialId = material.id;

    if (!hasSession()) {
        promptBuyerLogin("Log in as a buyer to pay with UPI.");
        return;
    }

    if (!isBuyer()) {
        promptBuyerLogin("Only buyer accounts can use UPI checkout. Log in with a buyer account.");
        return;
    }

    openPaymentModal(material);
    setMessage(paymentMessage, "Creating your UPI payment request...");

    try {
        const response = await fetch(apiUrl("/api/orders"), {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${state.user.token}`
            },
            body: JSON.stringify({
                material_id: material.id
            })
        });

        const data = await response.json();
        if (!response.ok) {
            if (response.status === 401) {
                saveUser(null);
                updateSessionUI();
                renderMaterials();
            }
            throw new Error(data.error || "Could not start UPI payment.");
        }

        state.activeOrder = data.order;
        paymentUpiId.textContent = data.platform_upi_id;
        paymentOrderReference.textContent = `Use order ref ${data.order.transaction_ref} in your UPI app note.`;
        paymentOpenUpi.href = data.upi_link;
        paymentOpenUpi.classList.remove("hidden");
        paymentForm.classList.remove("hidden");
        setMessage(paymentMessage, "Open your UPI app, complete the payment, then enter your UPI transaction reference below.", "success");
    } catch (error) {
        setMessage(paymentMessage, error.message, "error");
    }
}

async function handlePaymentSubmit(event) {
    event.preventDefault();

    if (!state.activeOrder) {
        setMessage(paymentMessage, "Create a UPI payment request first.", "error");
        return;
    }

    const paymentReference = paymentReferenceInput.value.trim();
    if (!paymentReference) {
        setMessage(paymentMessage, "Please enter your UPI transaction reference.", "error");
        return;
    }

    setMessage(paymentMessage, "Confirming your payment...");

    try {
        const response = await fetch(apiUrl("/api/orders/confirm"), {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${state.user.token}`
            },
            body: JSON.stringify({
                order_id: state.activeOrder.id,
                payment_reference: paymentReference
            })
        });

        const data = await response.json();
        if (!response.ok) {
            if (response.status === 401) {
                saveUser(null);
                updateSessionUI();
                renderMaterials();
            }
            throw new Error(data.error || "Could not confirm payment.");
        }

        state.activeOrder = data.order;
        paymentOrderReference.textContent = `Order ${data.order.transaction_ref} paid with UPI ref ${data.order.payment_reference}.`;
        paymentForm.classList.add("hidden");
        paymentOpenUpi.classList.add("hidden");
        setMessage(paymentMessage, "UPI payment confirmed. The order is marked as paid.", "success");
        state.pendingPurchaseMaterialId = null;
    } catch (error) {
        setMessage(paymentMessage, error.message, "error");
    }
}

async function handleListingSubmit(event) {
    event.preventDefault();

    if (!isSeller()) {
        setMessage(listingMessage, "Please log in as a seller before publishing a listing.", "error");
        openAuthModal("login", "seller");
        return;
    }

    setMessage(listingMessage, "Publishing your listing...");

    const formData = new FormData(listingForm);
    const payload = {
        title: String(formData.get("title") || "").trim(),
        category: String(formData.get("category") || "").trim(),
        description: String(formData.get("description") || "").trim(),
        price: Number(formData.get("price") || 0)
    };

    try {
        const response = await fetch(apiUrl("/api/materials"), {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${state.user.token}`
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        if (!response.ok) {
            if (response.status === 401) {
                saveUser(null);
                updateSessionUI();
                renderMaterials();
            }
            throw new Error(data.error || "Could not publish listing.");
        }

        listingForm.reset();
        updatePayoutPreview();
        setMessage(listingMessage, "Listing published successfully.", "success");
        await fetchMaterials(searchInput.value);
        window.location.hash = "marketplace";
    } catch (error) {
        setMessage(listingMessage, error.message, "error");
    }
}

function bindEvents() {
    document.querySelectorAll("[data-auth-trigger]").forEach((button) => {
        button.addEventListener("click", () => {
            openAuthModal(button.dataset.authTrigger || "signup", button.dataset.role || "buyer");
        });
    });

    document.getElementById("close-modal").addEventListener("click", closeAuthModal);
    document.getElementById("close-payment-modal").addEventListener("click", closePaymentModal);

    authModal.addEventListener("click", (event) => {
        if (event.target === authModal) {
            closeAuthModal();
        }
    });

    paymentModal.addEventListener("click", (event) => {
        if (event.target === paymentModal) {
            closePaymentModal();
        }
    });

    document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") {
            return;
        }

        if (!paymentModal.classList.contains("hidden")) {
            closePaymentModal();
            return;
        }

        if (!authModal.classList.contains("hidden")) {
            closeAuthModal();
        }
    });

    document.querySelectorAll("[data-mode-toggle]").forEach((button) => {
        button.addEventListener("click", () => setAuthMode(button.dataset.modeToggle));
    });

    document.querySelectorAll("[data-role-toggle]").forEach((button) => {
        button.addEventListener("click", () => setAuthRole(button.dataset.roleToggle));
    });

    authForm.addEventListener("submit", handleAuthSubmit);
    paymentForm.addEventListener("submit", handlePaymentSubmit);

    logoutButton.addEventListener("click", async () => {
        if (hasSession()) {
            try {
                await fetch(apiUrl("/api/logout"), {
                    method: "POST",
                    headers: {
                        "Authorization": `Bearer ${state.user.token}`
                    }
                });
            } catch (error) {
                // The UI can safely log out locally even if the request fails.
            }
        }

        saveUser(null);
        state.pendingPurchaseMaterialId = null;
        closePaymentModal();
        updateSessionUI();
        renderMaterials();
    });

    searchForm.addEventListener("submit", (event) => {
        event.preventDefault();
        fetchMaterials(searchInput.value);
    });

    searchInput.addEventListener("input", () => {
        clearTimeout(searchTimer);
        searchTimer = window.setTimeout(() => {
            fetchMaterials(searchInput.value);
        }, 180);
    });

    materialsGrid.addEventListener("click", (event) => {
        const buyButton = event.target.closest("[data-buy-material]");
        if (!buyButton) {
            return;
        }

        handleMaterialPurchase(buyButton.dataset.buyMaterial);
    });

    listingPriceInput.addEventListener("input", updatePayoutPreview);
    listingForm.addEventListener("submit", handleListingSubmit);
}

function init() {
    bindEvents();
    setAuthMode(state.authMode);
    setAuthRole(state.authRole);
    updateSessionUI();
    updatePayoutPreview();
    resetPaymentModal();
    fetchMaterials("");
}

init();
