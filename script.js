// your code goes here
let currentUser = null;
let feeChartInstance = null;
let adminChartInstance = null;
let allStudentsCache = [];

// ── Gemini AI Config ──────────────────────────────────────────────────────────
const GEMINI_API_KEY = "AIzaSyC-FlOO_7KmHnWqd83UcKcPdq7961y27t8";
const GEMINI_URL =`https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${GEMINI_API_KEY}`;

// ── UI ────────────────────────────────────────────────────────────────────────
function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    window.scrollTo(0, 0);
}
function goBack(id) { showScreen(id); }

function showToast(msg) {
    let t = document.createElement("div");
    t.className = "toast";
    t.innerText = msg;
    toastContainer.appendChild(t);
    setTimeout(() => t.remove(), 2500);
}

// ── STUDENT LOGIN ─────────────────────────────────────────────────────────────
async function studentLogin() {
    let query = await db.collection("students")
        .where("id", "==", studentId.value)
        .where("mobile", "==", mobile.value)
        .get();

    if (query.empty) return showToast("❌ Invalid ID or Mobile");

    let doc = query.docs[0];
    let user = { docId: doc.id, ...doc.data() };
    currentUser = user;

    document.getElementById('studentAvatar').innerText = user.name ? user.name[0].toUpperCase() : 'S';
    document.getElementById('studentName').innerText = user.name;
    document.getElementById('studentCourse').innerText = user.course || '';
    document.getElementById('studentSem').innerText = user.sem || '';

    let total = user.total || 0;
    let paid = user.paid || 0;
    let pending = total - paid;

    totalFees.innerText = total.toLocaleString('en-IN');
    paidFees.innerText = paid.toLocaleString('en-IN');
    pendingFees.innerText = pending.toLocaleString('en-IN');

    let pct = total > 0 ? Math.round((paid / total) * 100) : 0;
    document.getElementById('progressFill').style.width = pct + '%';
    document.getElementById('progressPercent').innerText = pct + '%';

    renderStudentChart(paid, pending);
    loadHistory();
    showScreen("studentDashboard");
}

// ── STUDENT FEE CHART ─────────────────────────────────────────────────────────
function renderStudentChart(paid, pending) {
    if (feeChartInstance) feeChartInstance.destroy();
    const ctx = document.getElementById('feeChart').getContext('2d');
    feeChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Paid', 'Pending'],
            datasets: [{
                data: [paid, pending],
                backgroundColor: ['#0e9f6e', '#f87171'],
                borderWidth: 0,
                hoverOffset: 6
            }]
        },
        options: {
            cutout: '72%',
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { font: { family: 'Outfit', size: 12 }, padding: 16 }
                },
                tooltip: {
                    callbacks: {
                        label: ctx => ' ₹' + ctx.parsed.toLocaleString('en-IN')
                    }
                }
            }
        }
    });
}

// ── ADMIN LOGIN ───────────────────────────────────────────────────────────────
function adminLogin() {
    if (adminMobile.value == "9334777278" && adminPassword.value == "Aditya@1205") {
        showScreen("adminDashboard");
        loadStudents();
        loadNotificationData();
    } else {
        showToast("❌ Wrong admin credentials");
    }
}

// ── PAYMENT ───────────────────────────────────────────────────────────────────
function openPayment() { showScreen("paymentModal"); }

async function submitPayment() {
    let amt = Number(payAmount.value);
    let txn = txnInput.value.trim();

    if (!amt || !txn) return showToast("⚠️ Fill all fields");

    await db.collection("transactions").add({
        txnId: txn,
        studentId: currentUser.id,
        studentName: currentUser.name,
        studentDocId: currentUser.docId,
        amount: amt,
        status: "pending",
        time: firebase.firestore.FieldValue.serverTimestamp()
    });

    payAmount.value = '';
    txnInput.value = '';
    showToast("✅ Payment submitted!");
    loadNotificationData();
    showScreen("studentDashboard");
}

// ── APPROVE ───────────────────────────────────────────────────────────────────
async function approve(docId, studentDocId, amount) {
    try {
        if (!studentDocId) return showToast("Error: Missing student ID");
        await db.collection("students").doc(studentDocId).update({
            paid: firebase.firestore.FieldValue.increment(Number(amount))
        });
        await db.collection("transactions").doc(docId).update({ status: "done" });
        showToast("✅ Approved!");
        loadStudents();
        loadNotificationData();
    } catch (e) {
        showToast("❌ Approve failed");
    }
}

// ── REJECT ────────────────────────────────────────────────────────────────────
async function reject(docId) {
    await db.collection("transactions").doc(docId).update({ status: "rejected" });
    showToast("❌ Rejected");
    loadNotificationData();
}

// ── NOTIFICATION ──────────────────────────────────────────────────────────────
function toggleNotification() {
    notificationBox.classList.toggle("hidden");
    loadNotificationData();
}

async function loadNotificationData() {
    let snapshot = await db.collection("transactions").get();
    let pending = [];

    snapshot.forEach(doc => {
        let t = { docId: doc.id, ...doc.data() };
        if (t.status === "pending") pending.push(t);
    });

    notifyCount.innerText = pending.length;

    notificationBox.innerHTML = pending.length === 0
        ? '<p style="font-size:13px;color:#64748b;text-align:center;padding:8px;">No pending payments</p>'
        : pending.map(t => `
        <div class="txn-card">
            <b>${t.studentName || t.studentId}</b> — ₹${Number(t.amount).toLocaleString('en-IN')}
            <p>TXN: ${t.txnId}</p>
            <div class="txn-actions">
                <button class="btn-approve" onclick="approve('${t.docId}','${t.studentDocId}','${t.amount}')">✔ Approve</button>
                <button class="btn-reject" onclick="reject('${t.docId}')">✖ Reject</button>
            </div>
        </div>`).join('');
}

// ── LOAD STUDENTS + ADMIN CHART ───────────────────────────────────────────────
async function loadStudents() {
    let snapshot = await db.collection("students").get();
    let list = [];
    snapshot.forEach(doc => list.push({ docId: doc.id, ...doc.data() }));
    allStudentsCache = list;
    renderStudents(list);
    renderAdminStats(list);
    renderAdminChart(list);
}

function renderStudents(list) {
    if (list.length === 0) {
        studentList.innerHTML = '<p style="text-align:center;color:#64748b;font-size:13px;padding:20px;">No students found</p>';
        return;
    }
    studentList.innerHTML = list.map(s => {
        let total = s.total || 0;
        let paid = s.paid || 0;
        let pending = total - paid;
        let pct = total > 0 ? Math.round((paid / total) * 100) : 0;
        return `
        <div class="student-card">
            <div class="student-card-header">
                <div>
                    <div class="student-card-name">${s.name || 'Unknown'}</div>
                    <div class="student-card-id">ID: ${s.id} &nbsp;|&nbsp; ${s.course} &nbsp;|&nbsp; ${s.sem}</div>
                </div>
                <div>
                    <span class="badge">${pct}%</span>
                </div>
            </div>
            <div style="font-size:12px;color:#64748b;display:flex;gap:12px;">
                <span>💰 ₹${total.toLocaleString('en-IN')}</span>
                <span style="color:#057a55;">✅ ₹${paid.toLocaleString('en-IN')}</span>
                <span style="color:#e02424;">⏳ ₹${pending.toLocaleString('en-IN')}</span>
            </div>
            <div class="mini-progress">
                <div class="mini-progress-fill" style="width:${pct}%"></div>
            </div>
            <div class="student-card-actions">
                <button class="btn-edit" onclick="edit('${s.docId}','${s.paid}')">✏️ Edit Paid</button>
                <button class="btn-delete" onclick="deleteStudent('${s.docId}')">🗑 Delete</button>
            </div>
        </div>`;
    }).join('');
}

// ── ADMIN STATS ───────────────────────────────────────────────────────────────
function renderAdminStats(list) {
    let totalStudents = list.length;
    let totalFee = list.reduce((a, s) => a + (s.total || 0), 0);
    let totalPaid = list.reduce((a, s) => a + (s.paid || 0), 0);
    let totalPending = totalFee - totalPaid;

    document.getElementById('adminStats').innerHTML = `
        <div class="stat-card">
            <div class="stat-num">${totalStudents}</div>
            <div class="stat-label">Total Students</div>
        </div>
        <div class="stat-card">
            <div class="stat-num" style="color:#0e9f6e;">₹${(totalPaid/1000).toFixed(1)}K</div>
            <div class="stat-label">Total Collected</div>
        </div>
        <div class="stat-card">
            <div class="stat-num" style="color:#e02424;">₹${(totalPending/1000).toFixed(1)}K</div>
            <div class="stat-label">Total Pending</div>
        </div>
        <div class="stat-card">
            <div class="stat-num" style="color:#f59e0b;">${totalFee > 0 ? Math.round((totalPaid/totalFee)*100) : 0}%</div>
            <div class="stat-label">Collection Rate</div>
        </div>
    `;
}

// ── ADMIN CHART ───────────────────────────────────────────────────────────────
function renderAdminChart(list) {
    let courses = {};
    list.forEach(s => {
        let c = s.course || 'Other';
        if (!courses[c]) courses[c] = { paid: 0, pending: 0 };
        courses[c].paid += s.paid || 0;
        courses[c].pending += (s.total || 0) - (s.paid || 0);
    });

    let labels = Object.keys(courses);
    let paidData = labels.map(c => courses[c].paid);
    let pendingData = labels.map(c => courses[c].pending);

    if (adminChartInstance) adminChartInstance.destroy();
    const ctx = document.getElementById('adminChart').getContext('2d');
    adminChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                { label: 'Paid', data: paidData, backgroundColor: '#0e9f6e', borderRadius: 6, borderSkipped: false },
                { label: 'Pending', data: pendingData, backgroundColor: '#f87171', borderRadius: 6, borderSkipped: false }
            ]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { position: 'top', labels: { font: { family: 'Outfit', size: 11 }, padding: 12 } },
                tooltip: { callbacks: { label: ctx => ' ₹' + ctx.parsed.y.toLocaleString('en-IN') } }
            },
            scales: {
                x: { grid: { display: false }, ticks: { font: { family: 'Outfit', size: 11 } } },
                y: {
                    grid: { color: '#f1f5f9' },
                    ticks: { font: { family: 'Outfit', size: 11 }, callback: v => '₹' + (v >= 1000 ? (v/1000) + 'K' : v) }
                }
            }
        }
    });
}

// ── SEARCH ────────────────────────────────────────────────────────────────────
async function searchStudents() {
    let v = searchInput.value.toLowerCase();
    let snapshot = await db.collection("students").get();
    let list = [];

    snapshot.forEach(doc => {
        let s = { docId: doc.id, ...doc.data() };
        if (
            (s.id && s.id.toLowerCase().includes(v)) ||
            (s.mobile && s.mobile.includes(v)) ||
            (s.name && s.name.toLowerCase().includes(v)) ||
            (s.course && s.course.toLowerCase().includes(v)) ||
            (s.sem && s.sem.toLowerCase().includes(v))
        ) list.push(s);
    });

    renderStudents(list);
}

// ── EDIT ──────────────────────────────────────────────────────────────────────
async function edit(docId, paid) {
    let val = prompt("Enter amount to add to paid:");
    if (!val || isNaN(val)) return;
    await db.collection("students").doc(docId).update({
        paid: Number(paid) + Number(val)
    });
    showToast("✅ Updated!");
    loadStudents();
}

// ── DELETE ────────────────────────────────────────────────────────────────────
async function deleteStudent(docId) {
    if (!confirm("Delete this student?")) return;
    await db.collection("students").doc(docId).delete();
    showToast("🗑 Deleted");
    loadStudents();
}

// ── ADD STUDENT ───────────────────────────────────────────────────────────────
async function addStudent() {
    let id = newId.value.trim();
    let name = newName.value.trim();
    let mob = newMobile.value.trim();
    let total = Number(newTotal.value);

    if (!id || !name || !mob || !total) return showToast("⚠️ Fill all fields");

    await db.collection("students").add({
        id, name,
        mobile: mob,
        total,
        paid: 0,
        course: newCourse.value,
        sem: newSem.value
    });

    newId.value = ''; newName.value = ''; newMobile.value = ''; newTotal.value = '';
    showToast("✅ Student Added!");
    showScreen("adminDashboard");
    loadStudents();
}

// ── HISTORY ───────────────────────────────────────────────────────────────────
async function loadHistory() {
    let snapshot = await db.collection("transactions")
        .where("studentId", "==", currentUser.id)
        .get();

    let history = [];
    snapshot.forEach(doc => history.push(doc.data()));

    historyList.innerHTML = history.length === 0
        ? '<p style="font-size:13px;color:#64748b;text-align:center;padding:12px;">No payment history</p>'
        : history.map(t => `
        <div class="txn-card">
            ₹${Number(t.amount).toLocaleString('en-IN')}
            <span class="status-${t.status}" style="float:right;">${t.status === 'done' ? '✅ Paid' : t.status === 'rejected' ? '❌ Rejected' : '⏳ Pending'}</span>
            <p>TXN: ${t.txnId}</p>
        </div>`).join('');
}

// ── COPY UPI ──────────────────────────────────────────────────────────────────
function copyUPI() {
    navigator.clipboard.writeText("9334777278@ybl");
    showToast("📋 Copied UPI ID!");
}

// ═══════════════════════════════════════════════════════════════════════════════
// ── AI ASSISTANT (GEMINI) ─────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

// ── Student AI Chat ───────────────────────────────────────────────────────────
function openAIChat() {
    document.getElementById('chatMessages').innerHTML = '';
    appendAIMessage("Namaste! 🙏 Main aapka Fee Assistant hoon. Aap mujhse apne fees, payments, ya kisi bhi cheez ke baare mein puch sakte hain!", 'ai');
    showScreen('aiChatScreen');
}

function askSuggestion(text) {
    document.getElementById('chatInput').value = text;
    sendChat();
}

async function sendChat() {
    let input = document.getElementById('chatInput');
    let msg = input.value.trim();
    if (!msg) return;

    appendAIMessage(msg, 'user');
    input.value = '';

    // Show typing indicator
    let typingId = showTyping('chatMessages');

    // Build context about current student
    let context = '';
    if (currentUser) {
        let total = currentUser.total || 0;
        let paid = currentUser.paid || 0;
        let pending = total - paid;
        let pct = total > 0 ? Math.round((paid / total) * 100) : 0;

        context = `
Student Information:
- Name: ${currentUser.name}
- Student ID: ${currentUser.id}
- Course: ${currentUser.course}
- Semester: ${currentUser.sem}
- Total Fee: ₹${total.toLocaleString('en-IN')}
- Paid Amount: ₹${paid.toLocaleString('en-IN')}
- Pending Amount: ₹${pending.toLocaleString('en-IN')}
- Payment Progress: ${pct}%
- UPI Payment: 9334777278@ybl

Institute: Global Institute of Information & Technology (GIIT)
Payment Method: UPI transfer to 9334777278@ybl or scan QR code in payment section.
`;
    }

    let systemPrompt = `You are a helpful fee assistant for GIIT (Global Institute of Information & Technology). 
Answer in a friendly, helpful way. You can reply in Hindi, Hinglish, or English based on what the student prefers.
Keep answers short and clear. Use emojis when appropriate.
${context}
If asked about fee status, give specific amounts from the student data above.
If asked how to pay, explain UPI payment method.`;

    try {
        let reply = await callGemini(systemPrompt, msg);
        removeTyping(typingId, 'chatMessages');
        appendAIMessage(reply, 'ai');
    } catch (e) {
        removeTyping(typingId, 'chatMessages');
        appendAIMessage("Maafi chahta hoon, abhi AI response nahi aa raha. Baad mein try karein. 🙏", 'ai');
    }
}

// ── Admin AI Chat ─────────────────────────────────────────────────────────────
function openAdminAI() {
    document.getElementById('adminChatMessages').innerHTML = '';
    appendAIMessage("Hello Admin! 👋 Main aapka AI Analytics Assistant hoon. Student data, fees, collections ke baare mein kuch bhi pucho!", 'ai', 'adminChatMessages');
    showScreen('adminAIScreen');
}

function askAdminSuggestion(text) {
    document.getElementById('adminChatInput').value = text;
    sendAdminChat();
}

async function sendAdminChat() {
    let input = document.getElementById('adminChatInput');
    let msg = input.value.trim();
    if (!msg) return;

    appendAIMessage(msg, 'user', 'adminChatMessages');
    input.value = '';

    let typingId = showTyping('adminChatMessages');

    // Build full students data context
    let studentSummary = '';
    if (allStudentsCache.length > 0) {
        let totalFee = allStudentsCache.reduce((a, s) => a + (s.total || 0), 0);
        let totalPaid = allStudentsCache.reduce((a, s) => a + (s.paid || 0), 0);
        let totalPending = totalFee - totalPaid;

        // Group by course
        let courses = {};
        allStudentsCache.forEach(s => {
            let c = s.course || 'Other';
            if (!courses[c]) courses[c] = { count: 0, paid: 0, total: 0 };
            courses[c].count++;
            courses[c].paid += s.paid || 0;
            courses[c].total += s.total || 0;
        });

        let courseSummary = Object.entries(courses).map(([c, d]) =>
            `${c}: ${d.count} students, ₹${d.paid.toLocaleString('en-IN')} paid / ₹${d.total.toLocaleString('en-IN')} total`
        ).join('\n');

        // Top pending students
        let sortedByPending = [...allStudentsCache]
            .sort((a, b) => ((b.total||0)-(b.paid||0)) - ((a.total||0)-(a.paid||0)))
            .slice(0, 5)
            .map(s => `${s.name} (${s.course}): ₹${((s.total||0)-(s.paid||0)).toLocaleString('en-IN')} pending`)
            .join('\n');

        studentSummary = `
ADMIN DASHBOARD DATA:
Total Students: ${allStudentsCache.length}
Total Fee: ₹${totalFee.toLocaleString('en-IN')}
Total Collected: ₹${totalPaid.toLocaleString('en-IN')}
Total Pending: ₹${totalPending.toLocaleString('en-IN')}
Collection Rate: ${totalFee > 0 ? Math.round((totalPaid/totalFee)*100) : 0}%

Course-wise Summary:
${courseSummary}

Top 5 Students with Highest Pending:
${sortedByPending}

All Students:
${allStudentsCache.map(s => `- ${s.name} | ${s.course} ${s.sem} | Paid: ₹${(s.paid||0).toLocaleString('en-IN')} / ₹${(s.total||0).toLocaleString('en-IN')}`).join('\n')}
`;
    } else {
        studentSummary = "No student data available yet.";
    }

    let systemPrompt = `You are an intelligent fee management analytics assistant for GIIT (Global Institute of Information & Technology).
You have access to the following real-time student fee data:

${studentSummary}

Answer admin queries about fee collections, pending amounts, student summaries, course analysis, etc.
Be helpful, precise, and use Indian number formatting (e.g. ₹1,00,000).
Reply in Hindi, Hinglish, or English based on admin's preference.
Keep answers concise and data-driven. Use emojis when appropriate.`;
    try {
        let reply = await callGemini(systemPrompt, msg);
        removeTyping(typingId, 'adminChatMessages');
        appendAIMessage(reply, 'ai', 'adminChatMessages');
    } catch (e) {
        removeTyping(typingId, 'adminChatMessages');
        appendAIMessage("Maafi chahta hoon, abhi AI response nahi aa raha. Baad mein try karein. 🙏", 'ai', 'adminChatMessages');
    }
}
// ── Gemini API Call ───────────────────────────────────────────────────────────
async function callGemini(systemPrompt, userMessage) {
    const response = await fetch(GEMINI_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [
                {
                    role: "user",
                    parts: [{ text: systemPrompt + "\n\nUser: " + userMessage }]
                }
            ],
            generationConfig: {
                temperature: 0.7,
                maxOutputTokens: 512
            }
        })
    });
    if (!response.ok) throw new Error('Gemini API error');
    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "Koi response nahi mila.";
}
// ── Chat UI Helpers ───────────────────────────────────────────────────────────
function appendAIMessage(text, role, containerId = 'chatMessages') {
    let container = document.getElementById(containerId);
    let div = document.createElement('div');
    div.className = `chat-bubble chat-${role}`;
    div.innerText = text;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}
function showTyping(containerId = 'chatMessages') {
    let container = document.getElementById(containerId);
    let id = 'typing_' + Date.now();
    let div = document.createElement('div');
    div.className = 'chat-bubble chat-ai chat-typing';
    div.id = id;
    div.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    return id;
}
function removeTyping(id, containerId = 'chatMessages') {
    let el = document.getElementById(id);
    if (el) el.remove();
}