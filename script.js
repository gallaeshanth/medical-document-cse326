
const DB_NAME = "MedVaultDB";
const STORE_NAME = "documents";
const CATEGORIES = [
    "Lab Reports",
    "Prescriptions",
    "Medical Scans",
    "Insurance",
    "Vaccination",
    "Other"
];

let db;
let documents = [];
let currentPreviewId = null;
let toastTimer;

// IndexedDB setup
function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);

        request.onupgradeneeded = event => {
            const database = event.target.result;

            if (!database.objectStoreNames.contains(STORE_NAME)) {
                database.createObjectStore(STORE_NAME, {
                    keyPath: "id",
                    autoIncrement: true
                });
            }
        };

        request.onsuccess = event => {
            db = event.target.result;
            resolve(db);
        };

        request.onerror = () => reject(request.error);
    });
}

function dbRequest(mode, action, data) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, mode);
        const store = transaction.objectStore(STORE_NAME);
        let request;

        if (action === "getAll") request = store.getAll();
        if (action === "add") request = store.add(data);
        if (action === "put") request = store.put(data);
        if (action === "delete") request = store.delete(data);

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

// Utilities
function formatDate(date) {
    if (!date) return "Not specified";

    return new Date(date + "T00:00:00").toLocaleDateString(
        "en-IN",
        { day: "numeric", month: "short", year: "numeric" }
    );
}

function escapeHTML(value = "") {
    return String(value).replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[char]);
}

function showToast(message) {
    const toast = document.getElementById("toast");

    toast.textContent = message;
    toast.classList.add("show");

    clearTimeout(toastTimer);

    toastTimer = setTimeout(() => {
        toast.classList.remove("show");
    }, 3000);
}

function isImage(doc) {
    return doc.file.type.startsWith("image/");
}

function getFileIcon(doc) {
    if (isImage(doc)) {
        return "fa-image";
    }

    if (doc.file.type === "application/pdf") {
        return "fa-file-pdf";
    }

    return "fa-file";
}

function getIconClass(doc) {
    if (isImage(doc)) return "image";
    if (doc.file.type === "application/pdf") return "";
    return "other";
}

function getExpiryStatus(doc) {
    if (!doc.expiry) return null;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const expiryDate = new Date(doc.expiry + "T00:00:00");
    const difference = Math.ceil(
        (expiryDate - today) / (1000 * 60 * 60 * 24)
    );

    if (difference < 0) {
        return {
            text: "Expired",
            type: "expired",
            days: difference
        };
    }

    if (difference <= 30) {
        return {
            text: difference === 0
                ? "Expires today"
                : `Expires in ${difference} day${difference === 1 ? "" : "s"}`,
            type: "warning",
            days: difference
        };
    }

    return null;
}

// Refresh document collection
async function loadDocuments() {
    documents = await dbRequest("readonly", "getAll");
    renderDashboard();
    renderDocuments();
    renderCategories();
    renderReminders();
}

// Document card
function createDocumentCard(doc) {
    const expiry = getExpiryStatus(doc);

    let expiryHTML = "";

    if (expiry) {
        expiryHTML = `
            <div class="${expiry.type === "expired" ? "expired-badge" : "expiry-badge"}">
                <i class="fa-solid fa-clock"></i> ${expiry.text}
            </div>
        `;
    }

    return `
        <article class="document-card">
            <div class="doc-top">
                <div class="doc-icon ${getIconClass(doc)}">
                    <i class="fa-solid ${getFileIcon(doc)}"></i>
                </div>

                <span class="doc-category">${escapeHTML(doc.category)}</span>
            </div>

            ${expiryHTML}

            <h4>${escapeHTML(doc.name)}</h4>

            <p class="doc-provider">
                <i class="fa-solid fa-hospital"></i>
                ${escapeHTML(doc.provider || "Provider not specified")}
            </p>

            <div class="doc-meta">
                <i class="fa-regular fa-calendar"></i>
                ${formatDate(doc.date)}
            </div>

            <div class="doc-actions">
                <button onclick="previewDocument(${doc.id})">
                    <i class="fa-regular fa-eye"></i> View
                </button>

                <button onclick="downloadDocument(${doc.id})">
                    <i class="fa-solid fa-download"></i> Download
                </button>

                <button onclick="editDocument(${doc.id})">
                    <i class="fa-solid fa-pen"></i> Edit
                </button>

                <button onclick="deleteDocument(${doc.id})">
                    <i class="fa-solid fa-trash"></i> Delete
                </button>
            </div>

            <button class="secondary-btn full-btn" onclick="shareDocument(${doc.id})">
                <i class="fa-solid fa-share-nodes"></i> Share
            </button>
        </article>
    `;
}

function emptyState(message) {
    return `
        <div class="empty-state">
            <i class="fa-solid fa-folder-open"></i>
            <h3>${escapeHTML(message)}</h3>
            <p>Upload a document to get started.</p>
        </div>
    `;
}

// Dashboard
function renderDashboard() {
    document.getElementById("totalCount").textContent = documents.length;
    document.getElementById("categoryCount").textContent = CATEGORIES.length;

    const expiring = documents.filter(doc => getExpiryStatus(doc));
    document.getElementById("expiryCount").textContent = expiring.length;

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const recent = documents.filter(doc =>
        new Date(doc.uploadedAt) >= sevenDaysAgo
    );

    document.getElementById("recentCount").textContent = recent.length;

    const alerts = document.getElementById("expiryAlerts");

    if (expiring.length === 0) {
        alerts.innerHTML = `
            <div class="empty-alert">
                <i class="fa-solid fa-circle-check"></i>
                No expiry alerts currently.
            </div>
        `;
    } else {
        alerts.innerHTML = expiring.map(doc => `
            <div class="document-card">
                <strong>${escapeHTML(doc.name)}</strong>
                <p>${escapeHTML(doc.category)} — ${formatDate(doc.expiry)}</p>
                <button class="secondary-btn" onclick="previewDocument(${doc.id})">
                    View Document
                </button>
            </div>
        `).join("");
    }

    const latest = [...documents]
        .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt))
        .slice(0, 3);

    document.getElementById("recentDocuments").innerHTML =
        latest.length
            ? latest.map(createDocumentCard).join("")
            : emptyState("No documents uploaded yet");
}

// All documents
function renderDocuments() {
    const search = document.getElementById("searchInput").value.toLowerCase();
    const category = document.getElementById("categoryFilter").value;
    const sort = document.getElementById("sortFilter").value;

    let filtered = documents.filter(doc => {
        const matchesSearch =
            doc.name.toLowerCase().includes(search) ||
            (doc.provider || "").toLowerCase().includes(search) ||
            doc.category.toLowerCase().includes(search);

        const matchesCategory =
            category === "all" || doc.category === category;

        return matchesSearch && matchesCategory;
    });

    if (sort === "newest") {
        filtered.sort((a, b) => new Date(b.date) - new Date(a.date));
    }

    if (sort === "oldest") {
        filtered.sort((a, b) => new Date(a.date) - new Date(b.date));
    }

    if (sort === "name") {
        filtered.sort((a, b) => a.name.localeCompare(b.name));
    }

    document.getElementById("allDocuments").innerHTML =
        filtered.length
            ? filtered.map(createDocumentCard).join("")
            : emptyState("No matching documents found");
}

// Categories
function renderCategories() {
    const icons = [
        "fa-flask",
        "fa-prescription",
        "fa-x-ray",
        "fa-shield-heart",
        "fa-syringe",
        "fa-folder"
    ];

    document.getElementById("categoryCards").innerHTML =
        CATEGORIES.map((category, index) => {
            const count = documents.filter(
                doc => doc.category === category
            ).length;

            return `
                <div class="category-card"
                     onclick="filterByCategory('${category}')">
                    <i class="fa-solid ${icons[index]}"></i>
                    <h3>${category}</h3>
                    <p>${count} document${count === 1 ? "" : "s"}</p>
                </div>
            `;
        }).join("");
}

function filterByCategory(category) {
    document.getElementById("categoryFilter").value = category;
    showView("documents");
    renderDocuments();
}

// Reminders
function renderReminders() {
    const expiring = documents.filter(doc => getExpiryStatus(doc));

    document.getElementById("allReminders").innerHTML =
        expiring.length
            ? expiring.map(doc => `
                <div class="document-card">
                    <h3>${escapeHTML(doc.name)}</h3>
                    <p>${escapeHTML(doc.category)}</p>
                    <p>Provider: ${escapeHTML(doc.provider || "Not specified")}</p>
                    <p>Expiry: ${formatDate(doc.expiry)}</p>

                    <button class="primary-btn"
                            onclick="previewDocument(${doc.id})">
                        View Document
                    </button>
                </div>
            `).join("")
            : emptyState("No documents are expiring soon");
}

// Upload modal
function openUploadModal() {
    document.getElementById("uploadModal").classList.remove("hidden");
}

function closeUploadModal() {
    document.getElementById("uploadModal").classList.add("hidden");
}

document.getElementById("uploadBtn").addEventListener("click", openUploadModal);
document.getElementById("uploadBtn2").addEventListener("click", openUploadModal);
document.getElementById("closeUpload").addEventListener("click", closeUploadModal);

// Upload document
document.getElementById("uploadForm").addEventListener("submit", async event => {
    event.preventDefault();

    const file = document.getElementById("docFile").files[0];

    if (!file) {
        showToast("Please select a file.");
        return;
    }

    const allowedTypes = [
        "application/pdf",
        "image/jpeg",
        "image/png"
    ];

    if (!allowedTypes.includes(file.type)) {
        showToast("Please upload a PDF, JPG, or PNG file.");
        return;
    }

    if (file.size > 10 * 1024 * 1024) {
        showToast("File size must be less than 10 MB.");
        return;
    }

    const date = document.getElementById("docDate").value;
    const expiry = document.getElementById("docExpiry").value;

    if (expiry && expiry < date) {
        showToast("Expiry date cannot be before document date.");
        return;
    }

    const doc = {
        name: document.getElementById("docName").value.trim(),
        category: document.getElementById("docCategory").value,
        provider: document.getElementById("docProvider").value.trim(),
        date,
        expiry,
        file,
        uploadedAt: new Date().toISOString()
    };

    try {
        await dbRequest("readwrite", "add", doc);

        closeUploadModal();
        event.target.reset();

        await loadDocuments();

        showToast("Medical document uploaded successfully!");
    } catch (error) {
        console.error(error);
        showToast("Unable to save document.");
    }
});

// Preview
async function previewDocument(id) {
    const doc = documents.find(item => item.id === id);
    if (!doc) return;

    currentPreviewId = id;

    document.getElementById("previewTitle").textContent = doc.name;

    document.getElementById("previewDetails").textContent =
        `${doc.category} • ${doc.provider || "Provider not specified"} • ${formatDate(doc.date)}`;

    const content = document.getElementById("previewContent");
    content.innerHTML = "";

    const url = URL.createObjectURL(doc.file);

    if (isImage(doc)) {
        const image = document.createElement("img");
        image.src = url;
        image.alt = doc.name;
        content.appendChild(image);
    } else if (doc.file.type === "application/pdf") {
        const iframe = document.createElement("iframe");
        iframe.src = url;
        iframe.title = "PDF document preview";
        content.appendChild(iframe);
    } else {
        content.textContent = "Preview is not available for this file.";
    }

    document.getElementById("previewModal").classList.remove("hidden");
}

document.getElementById("closePreview").addEventListener("click", () => {
    document.getElementById("previewModal").classList.add("hidden");
    document.getElementById("previewContent").innerHTML = "";
});

document.getElementById("previewDownload").addEventListener("click", () => {
    if (currentPreviewId) downloadDocument(currentPreviewId);
});

// Download
function downloadDocument(id) {
    const doc = documents.find(item => item.id === id);
    if (!doc) return;

    const url = URL.createObjectURL(doc.file);
    const link = document.createElement("a");

    link.href = url;
    link.download = doc.file.name;

    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Sharing
async function shareDocument(id) {
    const doc = documents.find(item => item.id === id);
    if (!doc) return;

    const file = new File(
        [doc.file],
        doc.file.name,
        { type: doc.file.type }
    );

    if (navigator.share && navigator.canShare &&
        navigator.canShare({ files: [file] })) {

        try {
            await navigator.share({
                title: doc.name,
                text: "Medical document shared from MedVault",
                files: [file]
            });

            showToast("Sharing completed.");
        } catch (error) {
            if (error.name !== "AbortError") {
                showToast("Sharing cancelled or unavailable.");
            }
        }
    } else {
        downloadDocument(id);
        showToast("Sharing is unavailable. File downloaded instead.");
    }
}

document.getElementById("previewShare").addEventListener("click", () => {
    if (currentPreviewId) shareDocument(currentPreviewId);
});

// Edit document metadata
async function editDocument(id) {
    const doc = documents.find(item => item.id === id);
    if (!doc) return;

    const name = prompt("Document name:", doc.name);
    if (name === null) return;

    const provider = prompt("Healthcare provider:", doc.provider || "");
    if (provider === null) return;

    const expiry = prompt(
        "Expiry date (YYYY-MM-DD), or leave blank:",
        doc.expiry || ""
    );

    if (expiry === null) return;

    if (expiry && !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) {
        showToast("Enter expiry date as YYYY-MM-DD.");
        return;
    }

    if (expiry && expiry < doc.date) {
        showToast("Expiry date cannot be before document date.");
        return;
    }

    doc.name = name.trim() || doc.name;
    doc.provider = provider.trim();
    doc.expiry = expiry;

    await dbRequest("readwrite", "put", doc);
    await loadDocuments();

    showToast("Document details updated.");
}

// Delete
async function deleteDocument(id) {
    const doc = documents.find(item => item.id === id);
    if (!doc) return;

    const confirmed = confirm(
        `Are you sure you want to delete "${doc.name}"?`
    );

    if (!confirmed) return;

    await dbRequest("readwrite", "delete", id);
    await loadDocuments();

    showToast("Document deleted.");
}

// Navigation
function showView(viewName) {
    document.querySelectorAll(".view").forEach(view => {
        view.classList.add("hidden");
    });

    const view = document.getElementById(viewName + "View");

    if (view) {
        view.classList.remove("hidden");
    }

    document.querySelectorAll(".nav-link[data-view]").forEach(link => {
        link.classList.toggle(
            "active",
            link.dataset.view === viewName
        );
    });

    const titles = {
        dashboard: "Dashboard",
        documents: "My Documents",
        categories: "Categories",
        reminders: "Expiry Reminders"
    };

    document.getElementById("pageTitle").textContent =
        titles[viewName] || "MedVault";
}

document.querySelectorAll("[data-view]").forEach(link => {
    link.addEventListener("click", event => {
        event.preventDefault();
        showView(link.dataset.view);
    });
});

// Search and filter
document.getElementById("searchInput").addEventListener("input", renderDocuments);
document.getElementById("categoryFilter").addEventListener("change", renderDocuments);
document.getElementById("sortFilter").addEventListener("change", renderDocuments);

// Notifications
document.getElementById("notificationBtn").addEventListener("click", () => {
    showView("reminders");
});

// Password lock
const LOCK_KEY = "medvault_password_hash";
let isLocked = false;

async function hashPassword(password) {
    const data = new TextEncoder().encode(password);
    const hash = await crypto.subtle.digest("SHA-256", data);

    return Array.from(new Uint8Array(hash))
        .map(byte => byte.toString(16).padStart(2, "0"))
        .join("");
}

function openLockModal(unlockMode = false) {
    document.getElementById("lockModal").classList.remove("hidden");

    document.getElementById("lockTitle").textContent =
        unlockMode ? "Unlock Your Medical Vault" : "Protect Your Medical Vault";

    document.getElementById("lockDescription").textContent =
        unlockMode
            ? "Enter your password to access your documents."
            : "Create a password for this browser.";

    document.getElementById("confirmPassword").classList.toggle("hidden", unlockMode);
    document.getElementById("lockSubmit").classList.toggle("hidden", unlockMode);
    document.getElementById("unlockSubmit").classList.toggle("hidden", !unlockMode);

    document.getElementById("lockMessage").textContent = "";
}

document.getElementById("lockBtn").addEventListener("click", event => {
    event.preventDefault();

    if (isLocked) {
        showToast("The application is already locked.");
        return;
    }

    openLockModal(!localStorage.getItem(LOCK_KEY));
});

document.getElementById("cancelLock").addEventListener("click", () => {
    document.getElementById("lockModal").classList.add("hidden");
});

document.getElementById("lockSubmit").addEventListener("click", async () => {
    const password = document.getElementById("lockPassword").value;
    const confirmPassword = document.getElementById("confirmPassword").value;

    if (password.length < 6) {
        document.getElementById("lockMessage").textContent =
            "Password must be at least 6 characters.";
        return;
    }

    if (password !== confirmPassword) {
        document.getElementById("lockMessage").textContent =
            "Passwords do not match.";
        return;
    }

    const hash = await hashPassword(password);

    localStorage.setItem(LOCK_KEY, hash);

    isLocked = true;
    lockApplication();

    showToast("Application locked.");
});

document.getElementById("unlockSubmit").addEventListener("click", async () => {
    const password = document.getElementById("lockPassword").value;
    const savedHash = localStorage.getItem(LOCK_KEY);

    if (await hashPassword(password) === savedHash) {
        isLocked = false;

        document.getElementById("lockModal").classList.add("hidden");
        document.getElementById("lockPassword").value = "";

        showToast("Vault unlocked.");
    } else {
        document.getElementById("lockMessage").textContent =
            "Incorrect password.";
    }
});

function lockApplication() {
    document.getElementById("lockModal").classList.remove("hidden");

    document.getElementById("lockTitle").textContent = "Vault Locked";
    document.getElementById("lockDescription").textContent =
        "Enter your password to access your documents.";

    document.getElementById("confirmPassword").classList.add("hidden");
    document.getElementById("lockSubmit").classList.add("hidden");
    document.getElementById("unlockSubmit").classList.remove("hidden");
    document.getElementById("cancelLock").classList.add("hidden");
}

function checkExistingLock() {
    if (localStorage.getItem(LOCK_KEY)) {
        isLocked = true;
        lockApplication();
    }
}

// Initialize
async function init() {
    try {
        await initDB();
        await loadDocuments();
        checkExistingLock();

        showView("dashboard");
    } catch (error) {
        console.error(error);
        showToast("Unable to initialize MedVault.");
    }
}

init();
