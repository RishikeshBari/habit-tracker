// ─── Supabase Config ───────────────────────────────────────────────────────
const SUPABASE_URL = 'https://ngxzaywoelxukmrvbhux.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5neHpheXdvZWx4dWttcnZiaHV4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg0NjYwNzgsImV4cCI6MjA4NDA0MjA3OH0.3FRygU5-ftjM7ZKnZTqdB4d8q4_D8NZCG8nGWlKrQYw';

// Dependency check
(function() {
    console.log('🔍 Checking dependencies...');
    if (typeof Chart === 'undefined') { alert('Chart.js failed to load.'); return; }
    if (typeof supabase === 'undefined') { alert('Supabase failed to load.'); return; }
    if (typeof Sortable === 'undefined') { console.warn('⚠️ SortableJS not loaded - drag disabled'); }
    console.log('✅ All dependencies loaded');
})();

let supabaseClient;
try {
    supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
} catch (e) {
    alert('Failed to init Supabase: ' + e.message);
}

// ─── State ─────────────────────────────────────────────────────────────────
let currentUser   = null;
let habits        = [];
let dividers      = [];
let completions   = {};   // key:"habitId-day" → INTEGER 1–100; absent key = 0% (no row)
let selectedRow   = null;
let editingHabitId   = null;
let editingDividerId = null;
let deletingHabitId  = null;
let sortableInstance = null;
let selectedColumn   = null;
let pendingChanges   = {};  // key:"habitId-day" → pct 0–100 (0 = delete on save)
let collapsedSections = new Set();

// Popover state
let _popHabitId = null;
let _popDay     = null;
// Weekly-task popover routing
let _popMode           = 'daily';  // 'daily' | 'weekly'
let _popWeeklyTaskId   = null;
let _popWeekStr        = null;

// ── Weekly tracker state ─────────────────────────────────────────────────
let weeklyTasks        = [];
let weeklyCompletions  = {};   // key: taskId → INTEGER 1–100; absent = 0% (no row)
let weekStart          = getMonday(new Date()); // Monday of the visible week
let editingWeeklyTaskId = null;

// Date state
let currentDate  = new Date();
let selectedMonth = currentDate.getMonth();
let selectedYear  = currentDate.getFullYear();
let daysInMonth   = new Date(selectedYear, selectedMonth + 1, 0).getDate();

const charts = { lineChart: null, pieChart: null, bestChart: null, worstChart: null,
                 wtDonutChart: null, wtBarChart: null };

// ═══════════════════════════════════════════════════════════════════
// THEME SYSTEM
// ═══════════════════════════════════════════════════════════════════
const THEMES = [
    { id: 'light',    name: 'Light',    swatch: 'linear-gradient(135deg, #4f46e5, #8b5cf6)' },
    { id: 'dark',     name: 'Dark',     swatch: 'linear-gradient(135deg, #818cf8, #1e293b)' },
    { id: 'ocean',    name: 'Ocean',    swatch: 'linear-gradient(135deg, #0891b2, #06b6d4)' },
    { id: 'forest',   name: 'Forest',   swatch: 'linear-gradient(135deg, #059669, #10b981)' },
    { id: 'sunset',   name: 'Sunset',   swatch: 'linear-gradient(135deg, #ea580c, #f97316)' },
    { id: 'rose',     name: 'Rose',     swatch: 'linear-gradient(135deg, #e11d48, #f43f5e)' },
    { id: 'midnight', name: 'Midnight', swatch: 'linear-gradient(135deg, #a78bfa, #020617)' },
    { id: 'custom',   name: 'Custom',   swatch: 'conic-gradient(#ef4444, #f59e0b, #22c55e, #3b82f6, #8b5cf6, #ef4444)' }
];
let _currentTheme = 'light';

function _themeStorageKey() {
    return currentUser ? `theme_${currentUser.id}` : 'theme_guest';
}

function initThemeSystem() {
    const saved = localStorage.getItem(_themeStorageKey());
    if (saved) {
        if (saved.startsWith('custom:')) {
            _currentTheme = 'custom';
            const colors = JSON.parse(saved.substring(7));
            _applyCustomColors(colors);
        } else {
            applyTheme(saved, false);
        }
    }
    renderThemeOptions();
}

function renderThemeOptions() {
    const container = document.getElementById('themeOptions');
    if (!container) return;
    container.innerHTML = '';
    THEMES.forEach(t => {
        const opt = document.createElement('div');
        opt.className = 'theme-option' + (_currentTheme === t.id ? ' active' : '');
        opt.innerHTML = `
            <div class="theme-swatch" style="background:${t.swatch};"></div>
            <span class="theme-option-name">${t.name}</span>
            <span class="theme-option-check">✓</span>`;
        opt.onclick = () => {
            if (t.id === 'custom') {
                document.getElementById('themeCustomSection').classList.add('visible');
                _currentTheme = 'custom';
                renderThemeOptions();
            } else {
                document.getElementById('themeCustomSection').classList.remove('visible');
                applyTheme(t.id, true);
            }
        };
        container.appendChild(opt);
    });
}

function applyTheme(themeId, persist = true) {
    _currentTheme = themeId;
    if (themeId === 'light') {
        document.documentElement.removeAttribute('data-theme');
    } else {
        document.documentElement.setAttribute('data-theme', themeId);
    }
    // Remove any custom inline CSS vars
    ['--primary','--secondary','--success'].forEach(v =>
        document.documentElement.style.removeProperty(v));
    if (persist) localStorage.setItem(_themeStorageKey(), themeId);
    renderThemeOptions();
    // Re-render charts with proper colors
    if (habits.length > 0) updateAnalytics();
    if (weeklyTasks.length > 0) updateWeeklyAnalytics();
}

function _applyCustomColors(colors) {
    document.documentElement.removeAttribute('data-theme');
    if (colors.primary)   document.documentElement.style.setProperty('--primary', colors.primary);
    if (colors.secondary) document.documentElement.style.setProperty('--secondary', colors.secondary);
    if (colors.success)   document.documentElement.style.setProperty('--success', colors.success);
    // Set gradients based on custom primary
    document.documentElement.style.setProperty('--auth-gradient',
        `linear-gradient(135deg, ${colors.primary} 0%, ${colors.secondary || colors.primary} 100%)`);
    document.documentElement.style.setProperty('--month-nav-gradient',
        `linear-gradient(135deg, ${colors.primary} 0%, ${colors.secondary || colors.primary} 100%)`);
}

function applyCustomTheme() {
    const primary   = document.getElementById('customPrimary').value;
    const secondary = document.getElementById('customSecondary').value;
    const success   = document.getElementById('customSuccess').value;
    const colors = { primary, secondary, success };
    _currentTheme = 'custom';
    _applyCustomColors(colors);
    localStorage.setItem(_themeStorageKey(), 'custom:' + JSON.stringify(colors));
    renderThemeOptions();
    if (habits.length > 0) updateAnalytics();
    if (weeklyTasks.length > 0) updateWeeklyAnalytics();
}

function toggleThemeDropdown() {
    const dd = document.getElementById('themeDropdown');
    dd.classList.toggle('open');
}

// Close dropdown on outside click
document.addEventListener('mousedown', (e) => {
    const wrap = document.getElementById('themePickerWrap');
    const dd   = document.getElementById('themeDropdown');
    if (wrap && dd && dd.classList.contains('open') && !wrap.contains(e.target)) {
        dd.classList.remove('open');
    }
});

// ═══════════════════════════════════════════════════════════════════
// HABIT FREQUENCY SYSTEM
// ═══════════════════════════════════════════════════════════════════
// frequency_type: 'daily' | 'specific_days' | 'interval'
// frequency_value: null | '["Mon","Wed","Fri"]' | '3'

let _freqType = 'daily';
let _freqDays = new Set();

function setFreqType(type) {
    _freqType = type;
    document.querySelectorAll('.freq-type-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.freq === type);
    });
    document.getElementById('freqDaysRow').classList.toggle('visible', type === 'specific_days');
    document.getElementById('freqIntervalRow').classList.toggle('visible', type === 'interval');
}

function toggleFreqDay(btn) {
    const day = btn.dataset.day;
    if (_freqDays.has(day)) { _freqDays.delete(day); btn.classList.remove('active'); }
    else                   { _freqDays.add(day);     btn.classList.add('active'); }
}

function getFreqFromModal() {
    if (_freqType === 'daily') return { type: 'daily', value: null };
    if (_freqType === 'specific_days') {
        const days = Array.from(_freqDays);
        return { type: 'specific_days', value: days.length > 0 ? JSON.stringify(days) : null };
    }
    if (_freqType === 'interval') {
        const n = parseInt(document.getElementById('freqIntervalInput').value, 10);
        return { type: 'interval', value: (!isNaN(n) && n >= 2) ? String(n) : null };
    }
    return { type: 'daily', value: null };
}

function setFreqInModal(type, value) {
    _freqType = type || 'daily';
    _freqDays = new Set();

    // Reset all UI
    document.querySelectorAll('.freq-type-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.freq === _freqType);
    });
    document.querySelectorAll('.freq-day-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('freqDaysRow').classList.toggle('visible', _freqType === 'specific_days');
    document.getElementById('freqIntervalRow').classList.toggle('visible', _freqType === 'interval');
    document.getElementById('freqIntervalInput').value = '2';

    if (_freqType === 'specific_days' && value) {
        try {
            const days = JSON.parse(value);
            days.forEach(d => _freqDays.add(d));
            document.querySelectorAll('.freq-day-btn').forEach(b => {
                b.classList.toggle('active', _freqDays.has(b.dataset.day));
            });
        } catch(e) {}
    } else if (_freqType === 'interval' && value) {
        document.getElementById('freqIntervalInput').value = value;
    }
}

// Core: Is a specific calendar day scheduled for this habit?
const _DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function isScheduledDay(habit, year, month, day) {
    const freqType  = habit.frequency_type || 'daily';
    const freqValue = habit.frequency_value;

    if (freqType === 'daily') return true;

    if (freqType === 'specific_days' && freqValue) {
        try {
            const allowedDays = JSON.parse(freqValue);   // e.g. ["Mon","Wed","Fri"]
            const d = new Date(year, month, day);
            const dayName = _DAY_NAMES[d.getDay()];
            return allowedDays.includes(dayName);
        } catch(e) { return true; }
    }

    if (freqType === 'interval' && freqValue) {
        const interval = parseInt(freqValue, 10);
        if (isNaN(interval) || interval < 2) return true;
        // Calculate days since habit creation
        const created = new Date(habit.created_at);
        created.setHours(0, 0, 0, 0);
        const target = new Date(year, month, day);
        target.setHours(0, 0, 0, 0);
        const diffDays = Math.round((target - created) / (1000 * 60 * 60 * 24));
        return diffDays >= 0 && (diffDays % interval === 0);
    }

    return true;
}

// Build a frequency badge label
function getFreqBadgeLabel(habit) {
    const ft = habit.frequency_type || 'daily';
    if (ft === 'daily') return '';
    if (ft === 'specific_days' && habit.frequency_value) {
        try {
            const days = JSON.parse(habit.frequency_value);
            const short = days.map(d => d.substring(0, 2));
            return short.join(', ');
        } catch(e) { return ''; }
    }
    if (ft === 'interval' && habit.frequency_value) {
        return `Every ${habit.frequency_value}d`;
    }
    return '';
}

// ─── Auth ──────────────────────────────────────────────────────────────────
function switchToSignup() {
    document.getElementById('loginForm').style.display = 'none';
    document.getElementById('signupForm').style.display = 'block';
    document.getElementById('forgotPasswordForm').style.display = 'none';
    document.getElementById('resetPasswordForm').style.display = 'none';
    document.getElementById('authError').innerHTML = '';
    document.querySelector('.auth-card p:not(.auth-toggle):not(.form-subtitle)').textContent =
        'Track your daily habits and build consistency';
}

function switchToLogin() {
    document.getElementById('signupForm').style.display = 'none';
    document.getElementById('loginForm').style.display = 'block';
    document.getElementById('forgotPasswordForm').style.display = 'none';
    document.getElementById('resetPasswordForm').style.display = 'none';
    document.getElementById('authError').innerHTML = '';
    document.querySelector('.auth-card p:not(.auth-toggle):not(.form-subtitle)').textContent =
        'Track your daily habits and build consistency';
}

function switchToForgotPassword() {
    document.getElementById('loginForm').style.display = 'none';
    document.getElementById('signupForm').style.display = 'none';
    document.getElementById('resetPasswordForm').style.display = 'none';
    document.getElementById('forgotPasswordForm').style.display = 'block';
    document.getElementById('authError').innerHTML = '';
    document.querySelector('.auth-card p:not(.auth-toggle):not(.form-subtitle)').textContent =
        'Reset your password';
}

function showResetPasswordForm() {
    // Make sure the auth screen is visible (in case auto-login ran)
    document.getElementById('authScreen').style.display = 'flex';
    document.getElementById('appContainer').classList.remove('active');
    document.getElementById('loginForm').style.display = 'none';
    document.getElementById('signupForm').style.display = 'none';
    document.getElementById('forgotPasswordForm').style.display = 'none';
    document.getElementById('resetPasswordForm').style.display = 'block';
    document.getElementById('authError').innerHTML = '';
    document.querySelector('.auth-card p:not(.auth-toggle):not(.form-subtitle)').textContent =
        'Set a new password';
    // Clear fields
    document.getElementById('newPassword').value = '';
    document.getElementById('confirmPassword').value = '';
    document.getElementById('strengthIndicator').textContent = '';
}

function showAuthError(msg) {
    document.getElementById('authError').innerHTML = `<div class="auth-error">${msg}</div>`;
}

function showAuthSuccess(msg) {
    document.getElementById('authError').innerHTML = `<div class="auth-success">${msg}</div>`;
}

// Real-time password strength indicator
function checkPasswordStrength(password) {
    const el = document.getElementById('strengthIndicator');
    if (!password) { el.textContent = ''; return; }
    let score = 0;
    if (password.length >= 8)  score++;
    if (password.length >= 12) score++;
    if (/[A-Z]/.test(password)) score++;
    if (/[0-9]/.test(password)) score++;
    if (/[^A-Za-z0-9]/.test(password)) score++;
    if (score <= 2) {
        el.textContent = '⬤ Weak password';
        el.className = 'password-strength strength-weak';
    } else if (score <= 3) {
        el.textContent = '⬤ Fair password';
        el.className = 'password-strength strength-fair';
    } else {
        el.textContent = '⬤ Strong password';
        el.className = 'password-strength strength-strong';
    }
}

async function login() {
    try {
        const email    = document.getElementById('loginEmail').value;
        const password = document.getElementById('loginPassword').value;
        if (!email || !password) { showAuthError('Please enter email and password'); return; }
        const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) { showAuthError(error.message); return; }
        currentUser = data.user;
        await initApp();
    } catch (e) { showAuthError('Login failed: ' + e.message); }
}

async function signup() {
    try {
        const email    = document.getElementById('signupEmail').value;
        const password = document.getElementById('signupPassword').value;
        if (!email || !password) { showAuthError('Please enter email and password'); return; }
        const { error } = await supabaseClient.auth.signUp({ email, password });
        if (error) { showAuthError(error.message); return; }
        showAuthError('Check your email to confirm signup!');
    } catch (e) { showAuthError('Signup failed: ' + e.message); }
}

async function logout() {
    try { await supabaseClient.auth.signOut(); location.reload(); }
    catch (e) { alert('Logout failed: ' + e.message); }
}

// ── Forgot Password ────────────────────────────────────────────────────────
async function requestPasswordReset() {
    try {
        const email = document.getElementById('forgotEmail').value.trim();
        if (!email) { showAuthError('Please enter your email address.'); return; }

        const btn = document.getElementById('forgotBtn');
        btn.disabled = true;
        btn.textContent = 'Sending…';

        // redirectTo must point back to this same page so the recovery
        // token in the URL hash is processed correctly.
        const redirectTo = window.location.origin + window.location.pathname;
        const { error } = await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo });

        btn.disabled = false;
        btn.textContent = 'Send Reset Link';

        if (error) { showAuthError(error.message); return; }

        // Always show success (don't reveal whether the email exists)
        showAuthSuccess('✓ If that email is registered, a reset link has been sent. Check your inbox and spam folder.');
        document.getElementById('forgotEmail').value = '';
    } catch (e) {
        document.getElementById('forgotBtn').disabled = false;
        document.getElementById('forgotBtn').textContent = 'Send Reset Link';
        showAuthError('Could not send reset email: ' + e.message);
    }
}

// ── Reset Password (called after user clicks the email link) ───────────────
async function resetPassword() {
    try {
        const newPassword     = document.getElementById('newPassword').value;
        const confirmPassword = document.getElementById('confirmPassword').value;

        if (!newPassword || !confirmPassword) {
            showAuthError('Please fill in both password fields.'); return;
        }
        if (newPassword.length < 8) {
            showAuthError('Password must be at least 8 characters long.'); return;
        }
        if (newPassword !== confirmPassword) {
            showAuthError('Passwords do not match.'); return;
        }

        const btn = document.getElementById('resetBtn');
        btn.disabled = true;
        btn.textContent = 'Updating…';

        const { error } = await supabaseClient.auth.updateUser({ password: newPassword });

        btn.disabled = false;
        btn.textContent = 'Update Password';

        if (error) { showAuthError(error.message); return; }

        showAuthSuccess('✓ Password updated! Redirecting to login…');
        document.getElementById('newPassword').value = '';
        document.getElementById('confirmPassword').value = '';
        document.getElementById('strengthIndicator').textContent = '';

        // Sign out the recovery session, then show the login form after a moment
        setTimeout(async () => {
            await supabaseClient.auth.signOut();
            // Clear the hash from the URL so a page refresh won't re-trigger recovery
            history.replaceState(null, '', window.location.pathname);
            switchToLogin();
            showAuthSuccess('Password updated successfully. Please log in.');
        }, 2000);

    } catch (e) {
        document.getElementById('resetBtn').disabled = false;
        document.getElementById('resetBtn').textContent = 'Update Password';
        showAuthError('Failed to update password: ' + e.message);
    }
}

// ─── App Init ──────────────────────────────────────────────────────────────
async function initApp() {
    try {
        document.getElementById('authScreen').style.display = 'none';
        document.getElementById('appContainer').classList.add('active');
        document.getElementById('userName').textContent = currentUser.email;
        initThemeSystem();
        initSidebar();
        updateMonthDisplay();
        await loadHabits();
        await loadWeeklyTasks();
        initQuote();
    } catch (e) { alert('Failed to initialize app: ' + e.message); }
}

// ─── Daily Quote Strip ─────────────────────────────────────────────────────

// Returns today as "YYYY-MM-DD" in local time
function _todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// Day-of-year (1–365), using local date
function _dayOfYear() {
    const now   = new Date();
    const start = new Date(now.getFullYear(), 0, 0);
    const diff  = now - start;
    const oneDay = 1000 * 60 * 60 * 24;
    return Math.floor(diff / oneDay);   // 1 = Jan 1, 365 = Dec 31
}

async function initQuote() {
    const strip     = document.getElementById('quoteStrip');
    const expandBtn = document.getElementById('quoteExpandBtn');
    if (!strip) return;

    const today = _todayStr();

    // If user already dismissed the quote this session → show only the expand button
    if (sessionStorage.getItem('quoteHiddenDate') === today) {
        strip.style.display = 'none';
        if (expandBtn) expandBtn.classList.add('visible');
        return;
    }

    // Compute which quote to show: day 1–365, looping with modulo
    const raw    = _dayOfYear();                       // 1–365
    const dayNum = ((raw - 1) % 365) + 1;             // always 1–365

    try {
        const { data, error } = await supabaseClient
            .from('daily_quotes')
            .select('quote_text')
            .eq('day_number', dayNum)
            .single();

        if (error || !data) {
            console.warn('Quote fetch failed:', error?.message);
            return;   // fail silently — don't break the app
        }

        document.getElementById('quoteText').textContent   = data.quote_text;
        document.getElementById('quoteAuthor').textContent = `Day ${dayNum} of 365`;

        // Show the strip with a smooth fade-up
        strip.style.display = '';
        strip.offsetHeight; // force reflow so CSS transition fires
        strip.classList.remove('qs-collapsed');
        if (expandBtn) expandBtn.classList.remove('visible');

    } catch (e) {
        console.warn('Quote error:', e.message);
    }
}

function collapseQuote() {
    const strip     = document.getElementById('quoteStrip');
    const expandBtn = document.getElementById('quoteExpandBtn');
    if (!strip) return;

    strip.classList.add('qs-collapsed');

    // After the CSS transition finishes, fully remove from flow
    strip.addEventListener('transitionend', () => {
        strip.style.display = 'none';
    }, { once: true });

    // Mark as dismissed for this calendar day (cleared on expand)
    sessionStorage.setItem('quoteHiddenDate', _todayStr());

    // Reveal the expand button in the topbar
    if (expandBtn) expandBtn.classList.add('visible');
}

function expandQuote() {
    const strip     = document.getElementById('quoteStrip');
    const expandBtn = document.getElementById('quoteExpandBtn');
    if (!strip) return;

    // Clear dismissed state so it stays open
    sessionStorage.removeItem('quoteHiddenDate');

    // Hide the topbar expand button
    if (expandBtn) expandBtn.classList.remove('visible');

    // Reveal and animate the strip back in
    strip.style.display = '';
    strip.offsetHeight; // force reflow
    strip.classList.remove('qs-collapsed');
}

// ─── Sidebar Drawer ────────────────────────────────────────────────────────
// Desktop (> 768px): push layout — sidebar width transitions, content shifts right
// Mobile  (≤ 768px): overlay — sidebar is position:fixed, backdrop dims content

function _isMobile() { return window.innerWidth <= 768; }

function initSidebar() {
    const savedPref  = localStorage.getItem('sidebarOpen');
    const shouldOpen = _isMobile() ? false : (savedPref !== 'false');
    // Suppress transition flash on initial load
    const sidebar = document.getElementById('sidebar');
    const origTransition = sidebar.style.transition;
    sidebar.style.transition = 'none';
    if (shouldOpen) _applySidebarOpen();
    else            _applySidebarClosed();
    requestAnimationFrame(() => { sidebar.style.transition = origTransition; });
}

function _applySidebarOpen() {
    document.getElementById('sidebar').classList.add('open');
    document.getElementById('sidebarToggle').classList.add('is-open');
    document.getElementById('toggleIcon').textContent  = '✕';
    document.getElementById('toggleLabel').textContent = 'Close';
    // Show overlay only on mobile
    if (_isMobile()) document.getElementById('sidebarOverlay').classList.add('active');
    localStorage.setItem('sidebarOpen', 'true');
}

function _applySidebarClosed() {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebarToggle').classList.remove('is-open');
    document.getElementById('toggleIcon').textContent  = '☰';
    document.getElementById('toggleLabel').textContent = 'Dashboard';
    document.getElementById('sidebarOverlay').classList.remove('active');
    localStorage.setItem('sidebarOpen', 'false');
}

function openSidebar()  { _applySidebarOpen();   }
function closeSidebar() { _applySidebarClosed(); }

function toggleSidebar() {
    const isOpen = document.getElementById('sidebar').classList.contains('open');
    isOpen ? closeSidebar() : openSidebar();
}

// Close on Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.getElementById('sidebar').classList.contains('open')) {
        closeSidebar();
    }
});

// On resize: switch between push and overlay behaviour gracefully
window.addEventListener('resize', () => {
    const sidebar   = document.getElementById('sidebar');
    const isOpen    = sidebar.classList.contains('open');
    const overlay   = document.getElementById('sidebarOverlay');
    if (_isMobile()) {
        // Mobile: ensure overlay is visible when open, hidden otherwise
        overlay.classList.toggle('active', isOpen);
        // Auto-close if user shrinks viewport; preference is already saved
        if (isOpen) closeSidebar();
    } else {
        // Desktop: never show overlay
        overlay.classList.remove('active');
        // Restore saved pref if growing to desktop
        const savedPref = localStorage.getItem('sidebarOpen');
        if (!isOpen && savedPref !== 'false') openSidebar();
    }
});

function updateMonthDisplay() {
    const months = ['January','February','March','April','May','June',
                    'July','August','September','October','November','December'];
    document.getElementById('currentMonthDisplay').textContent = `${months[selectedMonth]} ${selectedYear}`;
}

function changeMonth(delta) {
    if (Object.keys(pendingChanges).length > 0) {
        if (!confirm('You have unsaved changes. Changing months will discard them. Continue?')) return;
    }
    selectedMonth += delta;
    if (selectedMonth < 0)  { selectedMonth = 11; selectedYear--; }
    if (selectedMonth > 11) { selectedMonth = 0;  selectedYear++; }
    daysInMonth = new Date(selectedYear, selectedMonth + 1, 0).getDate();
    updateMonthDisplay();
    loadHabits();
}

function goToCurrentMonth() {
    if (Object.keys(pendingChanges).length > 0) {
        if (!confirm('You have unsaved changes. Going to current month will discard them. Continue?')) return;
    }
    currentDate   = new Date();
    selectedMonth = currentDate.getMonth();
    selectedYear  = currentDate.getFullYear();
    daysInMonth   = new Date(selectedYear, selectedMonth + 1, 0).getDate();
    updateMonthDisplay();
    loadHabits();
}

// ─── Load Data ─────────────────────────────────────────────────────────────
async function loadHabits() {
    try {
        const startOfMonth = new Date(selectedYear, selectedMonth, 1).toISOString();
        const endOfMonth   = new Date(selectedYear, selectedMonth + 1, 0, 23, 59, 59).toISOString();

        // 1. Fetch habits — exclude those whose end_date is before the start of the viewed month
        //    (end_date IS NULL = ongoing, end_date >= first day = still active this month or later)
        const firstDayStr = `${selectedYear}-${String(selectedMonth + 1).padStart(2,'0')}-01`;
        const { data: habitData, error: habitError } = await supabaseClient
            .from('habits')
            .select('*')
            .eq('user_id', currentUser.id)
            .or(`end_date.is.null,end_date.gte.${firstDayStr}`)
            .order('position', { ascending: true, nullsFirst: false });
        if (habitError) throw habitError;
        habits = habitData || [];

        // 2. Fetch dividers (NEW)
        const { data: dividerData, error: dividerError } = await supabaseClient
            .from('dividers')
            .select('*')
            .eq('user_id', currentUser.id)
            .order('position', { ascending: true, nullsFirst: false });
        // Silently continue if the dividers table doesn't exist yet
        if (dividerError) {
            console.warn('⚠️ Could not load dividers (table may not exist yet):', dividerError.message);
            dividers = [];
        } else {
            dividers = dividerData || [];
        }

        // 3. Fetch completions
        const { data: compData, error: compError } = await supabaseClient
            .from('habit_completions')
            .select('*')
            .eq('user_id', currentUser.id)
            .gte('completion_date', startOfMonth)
            .lte('completion_date', endOfMonth);
        if (compError) throw compError;

        completions = {};
        (compData || []).forEach(c => {
            const day = new Date(c.completion_date).getDate();
            // Store the actual percentage. Existing rows without the column → default 100.
            completions[`${c.habit_id}-${day}`] = c.completion_percentage || 100;
        });

        pendingChanges = {};
        updateSaveButtonState();
        renderTable();
    } catch (e) {
        console.error('Load habits error:', e);
        alert('Failed to load habits: ' + e.message);
    }
}

// ─── Percentage Cell Logic ─────────────────────────────────────────────────

// Core: set a cell to pct (0 = clear). Updates in-memory state + marks pending + re-renders.
function setCellPct(habitId, day, pct) {
    pct = Math.max(0, Math.min(100, Math.round(pct)));
    const key = `${habitId}-${day}`;
    if (pct === 0) { delete completions[key]; }
    else           { completions[key] = pct; }
    pendingChanges[key] = pct; // 0 = "delete on save", 1–100 = "upsert"
    renderTable();
    updateSaveButtonState();
}

// Silent variant — no re-render (used in batch column ops)
function setCellPctSilent(habitId, day, pct) {
    pct = Math.max(0, Math.min(100, Math.round(pct)));
    const key = `${habitId}-${day}`;
    if (pct === 0) { delete completions[key]; }
    else           { completions[key] = pct; }
    pendingChanges[key] = pct;
}

// ─── Popover ───────────────────────────────────────────────────────────────

function openPctPopover(habitId, day, currentPct, tdEl) {
    _popMode    = 'daily';   // ← set routing mode
    _popHabitId = habitId;
    _popDay     = day;
    // Clear weekly state
    _popWeeklyTaskId = null;
    _popWeekStr      = null;

    const habit = habits.find(h => h.id === habitId);
    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun',
                    'Jul','Aug','Sep','Oct','Nov','Dec'];
    document.getElementById('popTitle').textContent =
        `${habit ? habit.name : '–'}  ·  ${MONTHS[selectedMonth]} ${day}`;

    // Sync manual input to current value
    document.getElementById('pctManualInput').value = currentPct;
    document.getElementById('popActual').value = '';
    document.getElementById('popTarget').value = '';

    // Highlight matching quick button
    document.querySelectorAll('.pop-qbtn[data-pct]').forEach(btn => {
        btn.classList.toggle('is-active', parseInt(btn.dataset.pct) === currentPct);
    });

    // Position: below the cell, flip up if near bottom
    const pop  = document.getElementById('pctPopover');
    pop.style.display = 'block';
    const rect = tdEl.getBoundingClientRect();
    const pw   = pop.offsetWidth  || 230;
    const ph   = pop.offsetHeight || 260;

    let top  = rect.bottom + 5;
    let left = rect.left - pw / 2 + rect.width / 2;

    if (top + ph > window.innerHeight - 10) top = rect.top - ph - 5;
    if (left + pw > window.innerWidth  - 8) left = window.innerWidth - pw - 8;
    if (left < 8) left = 8;

    pop.style.top  = top  + 'px';
    pop.style.left = left + 'px';
}

function closePctPopover() {
    document.getElementById('pctPopover').style.display = 'none';
    _popMode         = 'daily';
    _popHabitId      = null;
    _popDay          = null;
    _popWeeklyTaskId = null;
    _popWeekStr      = null;
}

// Quick-button: apply and close — routes to daily or weekly based on _popMode
function applyPct(pct) {
    if (_popMode === 'weekly') {
        if (_popWeeklyTaskId === null) return;
        setWeeklyTaskPct(_popWeeklyTaskId, _popWeekStr, pct);
        closePctPopover();
    } else {
        if (_popHabitId === null) return;
        setCellPct(_popHabitId, _popDay, pct);
        closePctPopover();
    }
}

// Time calculator: apply when user clicks "Calculate & Apply"
function applyTimePct() {
    const actual = parseFloat(document.getElementById('popActual').value);
    const target = parseFloat(document.getElementById('popTarget').value);
    if (isNaN(actual) || isNaN(target) || target <= 0) {
        alert('Please enter valid numbers for both "Done" and "Goal" minutes.');
        return;
    }
    const pct = Math.round(Math.min(100, (actual / target) * 100));
    document.getElementById('pctManualInput').value = pct;
    applyPct(pct);
}

// Live-sync: update manual input while user types in actual-time box
function syncTimeToManual() {
    const actual = parseFloat(document.getElementById('popActual').value);
    const target = parseFloat(document.getElementById('popTarget').value);
    if (!isNaN(actual) && !isNaN(target) && target > 0) {
        document.getElementById('pctManualInput').value =
            Math.round(Math.min(100, (actual / target) * 100));
    }
}

// Manual stepper
function stepManual(delta) {
    const inp = document.getElementById('pctManualInput');
    const val = Math.max(0, Math.min(100, (parseInt(inp.value, 10) || 0) + delta));
    inp.value = val;
    document.querySelectorAll('.pop-qbtn[data-pct]').forEach(btn => {
        btn.classList.toggle('is-active', parseInt(btn.dataset.pct) === val);
    });
}

// Apply manual input
function applyManual() {
    const raw = parseInt(document.getElementById('pctManualInput').value, 10);
    if (isNaN(raw)) return;
    applyPct(Math.max(0, Math.min(100, raw)));
}

// Close on outside click
document.addEventListener('mousedown', (e) => {
    const pop = document.getElementById('pctPopover');
    if (pop && pop.style.display !== 'none' && !pop.contains(e.target)) {
        closePctPopover();
    }
});

function selectRow(row) {
    if (selectedRow) selectedRow.classList.remove('selected');
    selectedRow = row;
    row.classList.add('selected');
}

// ─── Habit Modal ───────────────────────────────────────────────────────────
function openHabitModal(habitId = null) {
    editingHabitId = habitId;
    const modal    = document.getElementById('habitModal');
    const input    = document.getElementById('habitName');
    const select   = document.getElementById('habitDivider');
    const endInput = document.getElementById('habitEndDate');
    const hint     = document.getElementById('endDateHint');

    // Populate section dropdown
    select.innerHTML = '<option value="">— No Section (Ungrouped) —</option>';
    dividers.sort((a, b) => a.position - b.position).forEach(d => {
        const opt = document.createElement('option');
        opt.value = d.id;
        opt.textContent = d.title;
        select.appendChild(opt);
    });

    if (habitId) {
        const habit = habits.find(h => h.id === habitId);
        document.getElementById('modalTitle').textContent = 'Edit Habit';
        input.value    = habit.name;
        select.value   = habit.divider_id || '';
        endInput.value = habit.end_date   || '';
        hint.style.display = habit.end_date ? 'block' : 'none';
        // Populate frequency
        setFreqInModal(habit.frequency_type || 'daily', habit.frequency_value || null);
    } else {
        document.getElementById('modalTitle').textContent = 'Add Habit';
        input.value    = '';
        select.value   = '';
        endInput.value = '';
        hint.style.display = 'none';
        // Reset frequency to daily
        setFreqInModal('daily', null);
    }

    // Show hint when user picks a date
    endInput.oninput = () => {
        hint.style.display = endInput.value ? 'block' : 'none';
    };

    modal.classList.add('active');
    input.focus();
}

function closeHabitModal() {
    document.getElementById('habitModal').classList.remove('active');
    editingHabitId = null;
}

async function saveHabit() {
    try {
        const name      = document.getElementById('habitName').value.trim();
        const dividerId = document.getElementById('habitDivider').value || null;
        const endDateRaw = document.getElementById('habitEndDate').value;
        const endDate   = endDateRaw || null;
        const freq      = getFreqFromModal();

        if (!name) { alert('Please enter a habit name'); return; }

        // Validate frequency
        if (freq.type === 'specific_days' && !freq.value) {
            alert('Please select at least one day of the week.'); return;
        }
        if (freq.type === 'interval' && !freq.value) {
            alert('Please enter a valid interval (2 or more days).'); return;
        }

        if (editingHabitId) {
            const { error } = await supabaseClient
                .from('habits')
                .update({ name, divider_id: dividerId, end_date: endDate,
                          frequency_type: freq.type, frequency_value: freq.value })
                .eq('id', editingHabitId)
                .eq('user_id', currentUser.id);
            if (error) throw error;
        } else {
            const maxPos = habits.length > 0
                ? Math.max(...habits.map(h => h.position !== null ? h.position : 0))
                : -1;
            const { error } = await supabaseClient
                .from('habits')
                .insert({ name, user_id: currentUser.id, position: maxPos + 1,
                          divider_id: dividerId, end_date: endDate,
                          frequency_type: freq.type, frequency_value: freq.value });
            if (error) throw error;
        }

        closeHabitModal();
        await loadHabits();
    } catch (e) { alert('Failed to save habit: ' + e.message); }
}

// ─── Delete Habit (two-option modal) ──────────────────────────────────────
function openDeleteHabitModal(habitId) {
    const habit = habits.find(h => h.id === habitId);
    if (!habit) return;
    deletingHabitId = habitId;

    document.getElementById('deleteHabitModalName').textContent = habit.name;

    // Build "Remove from [Month] onwards" label using the currently viewed month
    const monthNames = ['January','February','March','April','May','June',
                        'July','August','September','October','November','December'];
    document.getElementById('deleteModalMonthLabel').textContent =
        `${monthNames[selectedMonth]} ${selectedYear}`;

    document.getElementById('deleteHabitModal').classList.add('active');
}

function closeDeleteHabitModal() {
    document.getElementById('deleteHabitModal').classList.remove('active');
    deletingHabitId = null;
}

// Soft remove: set end_date = last day of the month BEFORE the currently viewed month.
// The habit disappears from the current and all future months; all past data is untouched.
async function removeHabitFromMonth() {
    if (!deletingHabitId) return;
    const habitId = deletingHabitId;
    closeDeleteHabitModal();
    try {
        // new Date(Y, M, 0) → last day of month M-1  (JS month is 0-indexed)
        const prevMonthLastDay = new Date(selectedYear, selectedMonth, 0);
        const endDateStr = toDateStr(prevMonthLastDay);

        const { error } = await supabaseClient
            .from('habits')
            .update({ end_date: endDateStr })
            .eq('id', habitId)
            .eq('user_id', currentUser.id);
        if (error) throw error;

        await loadHabits();
    } catch (e) { alert('Failed to remove habit: ' + e.message); }
}

// Hard delete: permanently removes the habit row (cascade deletes completions via FK or manual).
async function deleteHabitForever() {
    if (!deletingHabitId) return;
    const habitId = deletingHabitId;
    const habit   = habits.find(h => h.id === habitId);
    const name    = habit ? `"${habit.name}"` : 'this habit';
    if (!confirm(`Permanently delete ${name} and ALL its historical data?\n\nThis cannot be undone.`)) return;
    closeDeleteHabitModal();
    try {
        const { error } = await supabaseClient
            .from('habits').delete()
            .eq('id', habitId).eq('user_id', currentUser.id);
        if (error) throw error;
        await loadHabits();
    } catch (e) { alert('Failed to delete habit: ' + e.message); }
}

// ─── Divider / Section CRUD (NEW) ──────────────────────────────────────────

function openDividerModal(dividerId = null) {
    editingDividerId = dividerId;
    const modal = document.getElementById('dividerModal');
    const input = document.getElementById('dividerTitle');

    if (dividerId) {
        const div = dividers.find(d => d.id === dividerId);
        document.getElementById('dividerModalTitle').textContent = 'Edit Section';
        input.value = div ? div.title : '';
    } else {
        document.getElementById('dividerModalTitle').textContent = 'Add Section';
        input.value = '';
    }

    modal.classList.add('active');
    input.focus();
}

function closeDividerModal() {
    document.getElementById('dividerModal').classList.remove('active');
    editingDividerId = null;
}

async function saveDivider() {
    try {
        const title = document.getElementById('dividerTitle').value.trim();
        if (!title) { alert('Please enter a section title'); return; }

        if (editingDividerId) {
            // Update existing divider
            const { error } = await supabaseClient
                .from('dividers')
                .update({ title })
                .eq('id', editingDividerId)
                .eq('user_id', currentUser.id);
            if (error) throw error;
        } else {
            // Create new divider at end
            const maxPos = dividers.length > 0
                ? Math.max(...dividers.map(d => d.position !== null ? d.position : 0))
                : -1;
            const { error } = await supabaseClient
                .from('dividers')
                .insert({ title, user_id: currentUser.id, position: maxPos + 1 });
            if (error) throw error;
        }

        closeDividerModal();
        await loadHabits();
    } catch (e) { alert('Failed to save section: ' + e.message); }
}

async function deleteDivider(dividerId) {
    const div = dividers.find(d => d.id === dividerId);
    const divName = div ? `"${div.title}"` : 'this section';
    const habitsInSection = habits.filter(h => h.divider_id === dividerId);
            
    let confirmMsg = `Delete section ${divName}?`;
    if (habitsInSection.length > 0) {
        confirmMsg += `\n\nThe ${habitsInSection.length} habit(s) inside will be moved to "Ungrouped".`;
    }
            
    if (!confirm(confirmMsg)) return;

    try {
        // Move habits in this section to ungrouped
        if (habitsInSection.length > 0) {
            const { error: habitError } = await supabaseClient
                .from('habits')
                .update({ divider_id: null })
                .eq('divider_id', dividerId)
                .eq('user_id', currentUser.id);
            if (habitError) throw habitError;
        }

        // Delete the divider
        const { error } = await supabaseClient
            .from('dividers')
            .delete()
            .eq('id', dividerId)
            .eq('user_id', currentUser.id);
        if (error) throw error;

        await loadHabits();
    } catch (e) { alert('Failed to delete section: ' + e.message); }
}

// ─── Position Updates ──────────────────────────────────────────────────────
async function updateHabitPositions(habitIds) {
    try {
        const updates = habitIds.map((id, index) =>
            supabaseClient.from('habits').update({ position: index })
                .eq('id', id).eq('user_id', currentUser.id)
        );
        const results = await Promise.all(updates);
        const errors = results.filter(r => r.error);
        if (errors.length > 0) throw errors[0].error;
    } catch (e) { console.error('Update positions error:', e); await loadHabits(); }
}

// NEW: Unified position updater for drag-and-drop with divider support
async function updateAllPositions(habitUpdates, dividerUpdates) {
    try {
        const promises = [];

        // Update habit positions + divider_id
        habitUpdates.forEach(({ id, position, divider_id }) => {
            promises.push(
                supabaseClient.from('habits')
                    .update({ position, divider_id: divider_id || null })
                    .eq('id', id).eq('user_id', currentUser.id)
            );
        });

        // Update divider positions
        dividerUpdates.forEach(({ id, position }) => {
            promises.push(
                supabaseClient.from('dividers')
                    .update({ position })
                    .eq('id', id).eq('user_id', currentUser.id)
            );
        });

        const results = await Promise.all(promises);
        const errors  = results.filter(r => r.error);
        if (errors.length > 0) throw errors[0].error;

        console.log('✅ All positions updated');
    } catch (e) {
        console.error('updateAllPositions error:', e);
        alert('Failed to update order: ' + e.message);
        await loadHabits();
    }
}

// ─── Column Selection ──────────────────────────────────────────────────────
function selectColumn(day) {
    selectedColumn = day;
    document.querySelectorAll('.active-column').forEach(el => el.classList.remove('active-column'));
    const hdr = document.querySelector(`th.day-col[data-day="${day}"]`);
    if (hdr) hdr.classList.add('active-column');
    const gcell = document.querySelector(`th.global-checkbox-cell[data-day="${day}"]`);
    if (gcell) gcell.classList.add('active-column');
    document.querySelectorAll(`td[data-day="${day}"]`).forEach(td => td.classList.add('active-column'));
}

function toggleColumnCheckboxes(day) {
    try {
        const globalCb  = document.querySelector(`.global-checkbox[data-day="${day}"]`);
        const targetPct = globalCb.checked ? 100 : 0;
        selectColumn(day);
        habits.forEach(habit => {
            // Skip days before habit existed
            const cd = new Date(habit.created_at);
            if (cd.getFullYear() === selectedYear && cd.getMonth() === selectedMonth
                    && day < cd.getDate()) return;
            // Skip days past end_date
            if (habit.end_date) {
                const ed = new Date(habit.end_date + 'T00:00:00');
                if (ed.getFullYear() === selectedYear && ed.getMonth() === selectedMonth
                        && day > ed.getDate()) return;
            }
            // Skip non-scheduled days (frequency-aware)
            if (!isScheduledDay(habit, selectedYear, selectedMonth, day)) return;
            setCellPctSilent(habit.id, day, targetPct);
        });
        renderTable();
        updateSaveButtonState();
    } catch (e) { alert('Failed to update column: ' + e.message); }
}

function updateGlobalCheckboxStates() {
    for (let d = 1; d <= daysInMonth; d++) {
        const gcb = document.querySelector(`.global-checkbox[data-day="${d}"]`);
        if (!gcb) continue;

        const activeHabits = habits.filter(h => {
            const cd = new Date(h.created_at);
            if (cd.getFullYear() === selectedYear && cd.getMonth() === selectedMonth
                    && d < cd.getDate()) return false;
            if (h.end_date) {
                const ed = new Date(h.end_date + 'T00:00:00');
                if (ed.getFullYear() === selectedYear && ed.getMonth() === selectedMonth
                        && d > ed.getDate()) return false;
            }
            // Only count habits that are scheduled on this day
            return isScheduledDay(h, selectedYear, selectedMonth, d);
        });

        if (activeHabits.length === 0) { gcb.checked = false; gcb.indeterminate = false; continue; }

        const pcts    = activeHabits.map(h => completions[`${h.id}-${d}`] || 0);
        const allFull = pcts.every(p => p === 100);
        const allZero = pcts.every(p => p === 0);

        if      (allFull) { gcb.checked = true;  gcb.indeterminate = false; }
        else if (allZero) { gcb.checked = false; gcb.indeterminate = false; }
        else              { gcb.checked = false; gcb.indeterminate = true;  }
    }
}

// ─── Save / Discard ────────────────────────────────────────────────────────
function updateSaveButtonState() {
    const count      = Object.keys(pendingChanges).length;
    const saveBtn    = document.getElementById('saveBtn');
    const discardBtn = document.getElementById('discardBtn');
    const section    = document.getElementById('saveSection');
    const indicator  = document.getElementById('changesIndicator');
    const countEl    = document.getElementById('changesCount');

    if (count > 0) {
        saveBtn.disabled = false; saveBtn.classList.add('has-changes');
        discardBtn.disabled = false;
        section.classList.add('has-changes');
        indicator.style.display = 'flex';
        countEl.textContent = `${count} unsaved change${count > 1 ? 's' : ''}`;
    } else {
        saveBtn.disabled = true; saveBtn.classList.remove('has-changes');
        discardBtn.disabled = true;
        section.classList.remove('has-changes');
        indicator.style.display = 'none';
    }
}

async function saveAllChanges() {
    if (Object.keys(pendingChanges).length === 0) return;
    const saveBtn  = document.getElementById('saveBtn');
    const origText = saveBtn.textContent;
    try {
        saveBtn.textContent = 'Saving...';
        saveBtn.disabled    = true;

        // Build a flat list: { habitId, dateStr, pct }
        const pendingItems = [];
        for (const [key, pct] of Object.entries(pendingChanges)) {
            const lastDash = key.lastIndexOf('-');
            const habitId  = key.substring(0, lastDash);
            const day      = parseInt(key.substring(lastDash + 1), 10);
            if (isNaN(day)) throw new Error(`Invalid key: ${key}`);
            const dateStr = `${selectedYear}-${String(selectedMonth + 1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
            pendingItems.push({ habitId, dateStr, pct });
        }

        // Step 1 — delete every pending cell's existing row (clean slate)
        await Promise.all(
            pendingItems.map(({ habitId, dateStr }) =>
                supabaseClient.from('habit_completions').delete()
                    .eq('habit_id', habitId)
                    .eq('completion_date', dateStr)
                    .eq('user_id', currentUser.id)
            )
        );

        // Step 2 — re-insert non-zero entries with completion_percentage
        const insertions = pendingItems
            .filter(item => item.pct > 0)
            .map(({ habitId, dateStr, pct }) => ({
                habit_id:              habitId,
                user_id:               currentUser.id,
                completion_date:       dateStr,
                completion_percentage: pct
            }));

        if (insertions.length > 0) {
            const { error } = await supabaseClient
                .from('habit_completions')
                .insert(insertions);
            if (error) throw error;
        }

        pendingChanges = {};
        updateSaveButtonState();
        saveBtn.textContent = '✓ Saved!';
        saveBtn.style.background = '#10b981';
        setTimeout(() => { saveBtn.textContent = origText; saveBtn.style.background = ''; }, 2000);
    } catch (e) {
        console.error('Save error:', e);
        alert('Failed to save: ' + e.message);
        saveBtn.textContent = origText;
        saveBtn.disabled    = false;
        await loadHabits();
    }
}

async function discardChanges() {
    if (!confirm('Discard all unsaved changes?')) return;
    pendingChanges = {};
    await loadHabits();
    updateSaveButtonState();
}

// ─── Collapse / Expand a section ───────────────────────────────────────────
// Toggles visibility without a full re-render — just flips CSS classes in-place.
function toggleSection(dividerId) {
    const isNowCollapsed = !collapsedSections.has(dividerId);

    if (isNowCollapsed) {
        collapsedSections.add(dividerId);
    } else {
        collapsedSections.delete(dividerId);
    }

    // Update the divider header row
    const dividerRow = document.querySelector(`tr[data-divider-id="${dividerId}"]`);
    if (dividerRow) {
        dividerRow.classList.toggle('is-collapsed', isNowCollapsed);
        const btn = dividerRow.querySelector('.divider-collapse-btn');
        if (btn) {
            btn.classList.toggle('collapsed', isNowCollapsed);
            btn.title = isNowCollapsed ? 'Expand section' : 'Collapse section';
        }
    }

    // Show/hide all habit rows belonging to this section
    document.querySelectorAll(`tr[data-section-id="${dividerId}"]`).forEach(row => {
        row.classList.toggle('habit-row-hidden', isNowCollapsed);
    });
}

// ─── Pending Today — Premium Section ────────────────────────────────────

// Ring constants
const _RING_R = 36;
const _RING_CIRCUM = 2 * Math.PI * _RING_R;     // ≈ 226.2
const _RING_MINI_R = 12;
const _RING_MINI_C = 2 * Math.PI * _RING_MINI_R; // ≈ 75.4

function togglePendingSection() {
    const card    = document.getElementById('pendingCard');
    const chevron = document.getElementById('pendingChevron');
    const isNowCollapsed = !card.classList.contains('is-collapsed');

    card.classList.toggle('is-collapsed', isNowCollapsed);
    chevron.classList.toggle('collapsed', isNowCollapsed);

    // Swap SVG viewBox between full ring and mini ring
    const svg  = document.getElementById('pendingRingSvg');
    const track = svg.querySelector('.pending-ring-track');
    const fill  = svg.querySelector('.pending-ring-fill');

    if (isNowCollapsed) {
        svg.setAttribute('viewBox', '0 0 32 32');
        track.setAttribute('cx', '16');
        track.setAttribute('cy', '16');
        track.setAttribute('r', String(_RING_MINI_R));
        track.setAttribute('stroke-width', '3');
        fill.setAttribute('cx', '16');
        fill.setAttribute('cy', '16');
        fill.setAttribute('r', String(_RING_MINI_R));
        fill.setAttribute('stroke-width', '3');
        fill.setAttribute('transform', 'rotate(-90 16 16)');
        // Recalculate dasharray/offset for mini ring
        const pct = parseFloat(fill.dataset.pct || 0);
        fill.setAttribute('stroke-dasharray', String(_RING_MINI_C));
        fill.setAttribute('stroke-dashoffset', String(_RING_MINI_C * (1 - pct / 100)));
    } else {
        svg.setAttribute('viewBox', '0 0 88 88');
        track.setAttribute('cx', '44');
        track.setAttribute('cy', '44');
        track.setAttribute('r', String(_RING_R));
        track.setAttribute('stroke-width', '5');
        fill.setAttribute('cx', '44');
        fill.setAttribute('cy', '44');
        fill.setAttribute('r', String(_RING_R));
        fill.setAttribute('stroke-width', '5');
        fill.setAttribute('transform', 'rotate(-90 44 44)');
        const pct = parseFloat(fill.dataset.pct || 0);
        fill.setAttribute('stroke-dasharray', String(_RING_CIRCUM));
        fill.setAttribute('stroke-dashoffset', String(_RING_CIRCUM * (1 - pct / 100)));
    }

    sessionStorage.setItem('pendingCollapsed', isNowCollapsed ? '1' : '');
}

function _getMotivation(touchedCount, totalCount, pendingCount) {
    const pct = Math.round((touchedCount / totalCount) * 100);
    if (touchedCount === 0) return "Let's get started!";
    if (pct <= 40) return "Let's build some momentum!";
    if (pct <= 70) return "Great momentum! Keep it up.";
    if (pendingCount === 1) return "One more to go. Finish strong!";
    return "Almost there! Finish strong!";
}

function renderPendingSection() {
    const card        = document.getElementById('pendingCard');
    const list        = document.getElementById('pendingList');
    const ringNum     = document.getElementById('pendingRingNum');
    const ringDen     = document.getElementById('pendingRingDen');
    const ringFill    = document.getElementById('pendingRingFill');
    const motivation  = document.getElementById('pendingMotivation');
    const subText     = document.getElementById('pendingSub');
    const badge       = document.getElementById('pendingBadge');
    const chevron     = document.getElementById('pendingChevron');
    if (!card || !list) return;

    // Only show for the current month
    const now   = new Date();
    const today = now.getDate();
    const isCurrentMonth = selectedYear === now.getFullYear()
                        && selectedMonth === now.getMonth();
    if (!isCurrentMonth) { card.style.display = 'none'; return; }

    // Filter: habits active AND scheduled today (frequency-aware)
    const activeToday = habits.filter(h => {
        const cd = new Date(h.created_at);
        if (cd.getFullYear() === selectedYear && cd.getMonth() === selectedMonth
            && today < cd.getDate()) return false;
        if (h.end_date) {
            const ed = new Date(h.end_date + 'T00:00:00');
            if (ed.getFullYear() === selectedYear && ed.getMonth() === selectedMonth
                && today > ed.getDate()) return false;
            if (ed < new Date(selectedYear, selectedMonth, 1)) return false;
        }
        // Respect frequency: skip if today is not a scheduled day
        if (!isScheduledDay(h, selectedYear, selectedMonth, today)) return false;
        return true;
    });

    if (activeToday.length === 0) { card.style.display = 'none'; return; }

    // Compute stats: "completed" = any progress > 0%
    const totalCount   = activeToday.length;
    const touchedCount = activeToday.filter(h => (completions[`${h.id}-${today}`] || 0) > 0).length;
    const pct          = Math.round((touchedCount / totalCount) * 100);

    // Pending = 0% only (untouched), sorted by original section order
    const sortedDividers = [...dividers].sort((a, b) => (a.position ?? 999) - (b.position ?? 999));
    const dividerOrder   = {};
    sortedDividers.forEach((d, i) => { dividerOrder[d.id] = i + 1; });

    const pendingHabits = activeToday
        .filter(h => (completions[`${h.id}-${today}`] || 0) === 0)
        .sort((a, b) => {
            const aGroup = a.divider_id ? (dividerOrder[a.divider_id] ?? 999) : 0;
            const bGroup = b.divider_id ? (dividerOrder[b.divider_id] ?? 999) : 0;
            if (aGroup !== bGroup) return aGroup - bGroup;
            return (a.position ?? 999) - (b.position ?? 999);
        });

    const pendingCount = pendingHabits.length;
    const allDone      = pendingCount === 0;

    // Show card
    card.style.display = '';

    // State class: active vs done
    card.classList.toggle('state-active', !allDone);
    card.classList.toggle('state-done', allDone);

    // Restore collapse state from session
    const savedCollapsed = sessionStorage.getItem('pendingCollapsed') === '1';
    card.classList.toggle('is-collapsed', savedCollapsed);
    chevron.classList.toggle('collapsed', savedCollapsed);

    // Ring: update values
    ringNum.textContent = String(touchedCount);
    ringDen.textContent = `of ${totalCount}`;

    // Ring fill: calculate stroke-dashoffset
    const isCollapsed = card.classList.contains('is-collapsed');
    const circum = isCollapsed ? _RING_MINI_C : _RING_CIRCUM;
    ringFill.setAttribute('stroke-dasharray', String(circum));
    ringFill.setAttribute('stroke-dashoffset', String(circum * (1 - pct / 100)));
    ringFill.dataset.pct = String(pct);

    // Sync SVG geometry for current collapsed state
    const svg   = document.getElementById('pendingRingSvg');
    const track = svg.querySelector('.pending-ring-track');
    if (isCollapsed) {
        svg.setAttribute('viewBox', '0 0 32 32');
        track.setAttribute('cx', '16'); track.setAttribute('cy', '16');
        track.setAttribute('r', String(_RING_MINI_R)); track.setAttribute('stroke-width', '3');
        ringFill.setAttribute('cx', '16'); ringFill.setAttribute('cy', '16');
        ringFill.setAttribute('r', String(_RING_MINI_R)); ringFill.setAttribute('stroke-width', '3');
        ringFill.setAttribute('transform', 'rotate(-90 16 16)');
    } else {
        svg.setAttribute('viewBox', '0 0 88 88');
        track.setAttribute('cx', '44'); track.setAttribute('cy', '44');
        track.setAttribute('r', String(_RING_R)); track.setAttribute('stroke-width', '5');
        ringFill.setAttribute('cx', '44'); ringFill.setAttribute('cy', '44');
        ringFill.setAttribute('r', String(_RING_R)); ringFill.setAttribute('stroke-width', '5');
        ringFill.setAttribute('transform', 'rotate(-90 44 44)');
    }

    // Motivation text
    if (allDone) {
        motivation.textContent = 'Perfect day! All habits completed.';
        subText.textContent = `${totalCount} of ${totalCount} done · You're building real consistency`;
        badge.textContent = 'All done!';
    } else {
        motivation.textContent = _getMotivation(touchedCount, totalCount, pendingCount);
        subText.textContent = `${pendingCount} habit${pendingCount !== 1 ? 's' : ''} still waiting for you`;
        badge.textContent = `${pendingCount} pending`;
    }

    // Divider name lookup
    const dividerNames = {};
    dividers.forEach(d => { dividerNames[d.id] = d.title; });

    // Render list
    list.innerHTML = '';

    if (allDone) return;   // No list needed in done state

    pendingHabits.forEach(habit => {
        const sectionLabel = habit.divider_id && dividerNames[habit.divider_id]
            ? dividerNames[habit.divider_id] : 'Ungrouped';

        const item = document.createElement('div');
        item.className = 'pending-item';
        item.innerHTML = `
            <div class="pending-item-dot"></div>
            <span class="pending-item-name" title="${escapeHtml(habit.name)}">${escapeHtml(habit.name)}</span>
            <span class="pending-item-tag">${escapeHtml(sectionLabel)}</span>`;

        item.addEventListener('click', (e) => {
            e.stopPropagation();
            openPctPopover(habit.id, today, 0, item);
        });

        list.appendChild(item);
    });
}

// ─── RENDER TABLE ──────────────────────────────────────────────────────────
// Builds the full table including interleaved divider rows.
function renderTable() {
    try {
        const headerRow       = document.getElementById('headerRow');
        const globalRow       = document.getElementById('globalCheckboxRow');
        const dailyBody       = document.getElementById('dailyBody');
        if (!headerRow || !globalRow || !dailyBody) return;

        // Rebuild day headers
        headerRow.querySelectorAll('th.day-col').forEach(el => el.remove());
        globalRow.querySelectorAll('th.global-checkbox-cell').forEach(el => el.remove());

        const actionsHeader = headerRow.querySelector('.actions-col');
        const actionsGlobal = globalRow.querySelector('.actions-col');
        if (!actionsHeader || !actionsGlobal) return;

        const totalCols = 3 + daysInMonth + 1;  // habit + done + % + days + actions

        for (let d = 1; d <= daysInMonth; d++) {
            const th = document.createElement('th');
            th.className = 'day-col';
            th.textContent = d;
            th.dataset.day = d;
            if (selectedColumn === d) th.classList.add('active-column');
            headerRow.insertBefore(th, actionsHeader);

            const gth = document.createElement('th');
            gth.className = 'global-checkbox-cell';
            gth.dataset.day = d;
            if (selectedColumn === d) gth.classList.add('active-column');
            const gcb = document.createElement('input');
            gcb.type = 'checkbox'; gcb.className = 'global-checkbox'; gcb.dataset.day = d;
            gcb.onclick = () => toggleColumnCheckboxes(d);
            gth.appendChild(gcb);
            globalRow.insertBefore(gth, actionsGlobal);
        }

        dailyBody.innerHTML = '';

        // ── Build ordered render list ────────────────────────────────────
        // Structure: ungrouped habits first, then each divider with its habits.
        const renderList = [];

        // Ungrouped habits (no divider_id)
        const ungrouped = habits
            .filter(h => !h.divider_id)
            .sort((a, b) => (a.position ?? 999) - (b.position ?? 999));
        ungrouped.forEach(h => renderList.push({ type: 'habit', data: h }));

        // Sorted dividers + their habits
        const sortedDividers = [...dividers].sort((a, b) => (a.position ?? 999) - (b.position ?? 999));
        sortedDividers.forEach(div => {
            renderList.push({ type: 'divider', data: div });
            const divHabits = habits
                .filter(h => h.divider_id === div.id)
                .sort((a, b) => (a.position ?? 999) - (b.position ?? 999));
            divHabits.forEach(h => renderList.push({ type: 'habit', data: h, indented: true }));
        });

        // ── Render each item ─────────────────────────────────────────────
        renderList.forEach(item => {
            if (item.type === 'divider') {
                renderDividerRow(item.data, dailyBody, totalCols);
            } else {
                renderHabitRow(item.data, dailyBody, item.indented);
            }
        });

        updateGlobalCheckboxStates();
        if (typeof Sortable !== 'undefined') initializeDragAndDrop();
        updateAnalytics();
        renderPendingSection();
    } catch (e) {
        console.error('Render table error:', e);
    }
}

// ── Renders a single divider/section row ─────────────────────────────────
function renderDividerRow(divider, tbody, totalCols) {
    const isCollapsed = collapsedSections.has(divider.id);
    const habitCount  = habits.filter(h => h.divider_id === divider.id).length;

    const tr = document.createElement('tr');
    tr.className = 'divider-row' + (isCollapsed ? ' is-collapsed' : '');
    tr.dataset.dividerId = divider.id;

    const td = document.createElement('td');
    td.colSpan = totalCols;

    const dragHandle = typeof Sortable !== 'undefined'
        ? '<span class="divider-drag-handle drag-handle">⠿</span>'
        : '';

    td.innerHTML = `
        <div class="divider-banner">
            ${dragHandle}
            <div class="divider-title-area" onclick="toggleSection('${divider.id}')">
                <button class="divider-collapse-btn ${isCollapsed ? 'collapsed' : ''}"
                    title="${isCollapsed ? 'Expand' : 'Collapse'} section">▾</button>
                <span class="divider-title-text">${escapeHtml(divider.title)}</span>
                <span class="divider-count-badge">${habitCount} habit${habitCount !== 1 ? 's' : ''}</span>
            </div>
            <div class="divider-actions-group">
                <button class="divider-action-btn divider-edit-btn"
                    onclick="event.stopPropagation(); openDividerModal('${divider.id}')">Edit</button>
                <button class="divider-action-btn divider-delete-btn"
                    onclick="event.stopPropagation(); deleteDivider('${divider.id}')">Delete</button>
            </div>
        </div>`;
    tr.appendChild(td);
    tbody.appendChild(tr);
}

// ── Renders a single habit row ────────────────────────────────────────────
function renderHabitRow(habit, tbody, indented = false) {
    const createdDate  = new Date(habit.created_at);
    const createdDay   = createdDate.getDate();
    const createdMonth = createdDate.getMonth();
    const createdYear  = createdDate.getFullYear();
    const isThisMonth  = createdYear === selectedYear && createdMonth === selectedMonth;
    const startDay     = isThisMonth ? createdDay : 1;

    // end_date support: compute last trackable day for this month
    let endDay = daysInMonth;
    let hasEndThisMonth = false;
    if (habit.end_date) {
        const ed = new Date(habit.end_date + 'T00:00:00');
        if (ed.getFullYear() === selectedYear && ed.getMonth() === selectedMonth) {
            endDay = ed.getDate();
            hasEndThisMonth = true;
        }
    }

    // ── Weighted score: only count SCHEDULED days ─────────────────────
    let score = 0;
    let scheduledDays = 0;
    for (let d = startDay; d <= endDay; d++) {
        if (!isScheduledDay(habit, selectedYear, selectedMonth, d)) continue;
        scheduledDays++;
        score += (completions[`${habit.id}-${d}`] || 0) / 100;
    }
    const avgPct     = scheduledDays > 0 ? Math.round((score / scheduledDays) * 100) : 0;
    const scoreLabel = Number.isInteger(score) ? score : score.toFixed(1);

    const isHidden = habit.divider_id && collapsedSections.has(habit.divider_id);

    const tr = document.createElement('tr');
    tr.className = [
        'draggable-row',
        indented ? 'habit-indented' : '',
        hasEndThisMonth ? 'habit-row-ended' : '',
        isHidden ? 'habit-row-hidden' : ''
    ].filter(Boolean).join(' ');
    tr.dataset.habitId = habit.id;
    if (habit.divider_id) tr.dataset.sectionId = habit.divider_id;

    const dragHandle = typeof Sortable !== 'undefined'
        ? '<span class="drag-handle">☰</span>'
        : '';

    // End-date badge
    let endBadgeHtml = '';
    if (habit.end_date) {
        const ed = new Date(habit.end_date + 'T00:00:00');
        const label = ed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        endBadgeHtml = `<span class="end-date-badge" title="Ends ${label}">Ends ${label}</span>`;
    }

    // Frequency badge
    let freqBadgeHtml = '';
    const freqLabel = getFreqBadgeLabel(habit);
    if (freqLabel) {
        freqBadgeHtml = `<span class="freq-badge" title="Frequency: ${escapeHtml(freqLabel)}">${escapeHtml(freqLabel)}</span>`;
    }

    tr.innerHTML = `
        <td class="habit-col">
            ${dragHandle}
            <div class="habit-name-scroll" title="${escapeHtml(habit.name)}">
                ${escapeHtml(habit.name)}${freqBadgeHtml}${endBadgeHtml}
            </div>
        </td>
        <td class="stats-col">${scoreLabel}</td>
        <td class="stats-col">${avgPct}%</td>`;

    tr.addEventListener('click', (e) => {
        if (!e.target.classList.contains('drag-handle')) selectRow(tr);
    });

    // ── Day cells ─────────────────────────────────────────────────────────
    for (let d = 1; d <= daysInMonth; d++) {
        const td = document.createElement('td');
        td.dataset.day = d;
        if (selectedColumn === d) td.classList.add('active-column');

        if (isThisMonth && d < createdDay) {
            // (A) before habit existed
            const el = document.createElement('div');
            el.className = 'pct-cell pct-disabled';
            td.appendChild(el);

        } else if (d > endDay) {
            // (B) past end_date
            td.classList.add('cell-ended');
            const el = document.createElement('div');
            el.className = 'pct-cell pct-disabled';
            td.appendChild(el);

        } else if (!isScheduledDay(habit, selectedYear, selectedMonth, d)) {
            // (C) not scheduled — hatched/disabled
            td.classList.add('cell-not-scheduled');
            const el = document.createElement('div');
            el.className = 'pct-cell pct-disabled';
            td.appendChild(el);

        } else {
            // (D) normal interactive cell
            const cellPct = completions[`${habit.id}-${d}`] || 0;
            const el = buildPctCell(cellPct);
            td.appendChild(el);
            td.onclick = (e) => {
                e.stopPropagation();
                selectColumn(d);
                openPctPopover(habit.id, d, completions[`${habit.id}-${d}`] || 0, td);
            };
        }
        tr.appendChild(td);
    }

    const actionsTd = document.createElement('td');
    actionsTd.className = 'actions-col';
    actionsTd.innerHTML = `
        <button class="action-btn edit-btn"   onclick="openHabitModal('${habit.id}')">Edit</button>
        <button class="action-btn delete-btn" onclick="openDeleteHabitModal('${habit.id}')">Del</button>`;
    tr.appendChild(actionsTd);
    tbody.appendChild(tr);
}

// ── Build a single percentage cell element ────────────────────────────────
function buildPctCell(pct) {
    const el = document.createElement('div');
    if (pct <= 0) {
        el.className = 'pct-cell';
    } else if (pct >= 100) {
        el.className = 'pct-cell pct-full';
        el.innerHTML = '<span>✓</span>';
    } else {
        el.className = 'pct-cell pct-partial';
        el.style.setProperty('--fill', pct + '%');
        el.innerHTML = `<span>${pct}</span>`;
    }
    return el;
}

// ─── Drag and Drop ─────────────────────────────────────────────────────────
function initializeDragAndDrop() {
    try {
        const dailyBody = document.getElementById('dailyBody');
        if (sortableInstance) sortableInstance.destroy();

        sortableInstance = new Sortable(dailyBody, {
            animation: 150,
            handle: '.drag-handle',
            // ⚠️ KEY FIX: Do NOT set `draggable` to '.draggable-row'.
            // That was preventing habits from being dragged across divider rows
            // because SortableJS treated divider rows as invisible walls.
            // With no filter, ALL <tr> children participate in sorting.
            ghostClass: 'sortable-ghost',
            dragClass: 'sortable-drag',

            // Highlight the divider row when a habit is dragged over it
            onMove: function(evt) {
                // Clear previous highlights
                dailyBody.querySelectorAll('.drag-over-divider')
                    .forEach(el => el.classList.remove('drag-over-divider'));

                // If dragging a habit over/past a divider row, highlight the divider
                const related = evt.related;
                if (related && related.dataset.dividerId) {
                    related.classList.add('drag-over-divider');
                }
                return true; // allow the move
            },

            onEnd: async function(evt) {
                // Clean up any leftover highlights
                dailyBody.querySelectorAll('.drag-over-divider')
                    .forEach(el => el.classList.remove('drag-over-divider'));

                try {
                    // Walk ALL rows in current DOM order.
                    // currentDividerId tracks which section habits "belong to" —
                    // it updates every time we pass a divider row.
                    const allRows = Array.from(dailyBody.children);
                    let currentDividerId = null;
                    let dividerPosition  = 0;

                    const habitUpdates   = [];
                    const dividerUpdates = [];
                    const posCounters    = {}; // section key → counter

                    allRows.forEach(row => {
                        if (row.dataset.dividerId) {
                            dividerUpdates.push({ id: row.dataset.dividerId, position: dividerPosition++ });
                            currentDividerId = row.dataset.dividerId;
                        } else if (row.dataset.habitId) {
                            const posKey = currentDividerId || '__ungrouped__';
                            if (!(posKey in posCounters)) posCounters[posKey] = 0;
                            habitUpdates.push({
                                id:         row.dataset.habitId,
                                divider_id: currentDividerId,
                                position:   posCounters[posKey]++
                            });
                        }
                    });

                    console.log('🔀 New order — habits:', habitUpdates, '| dividers:', dividerUpdates);

                    // Update local state immediately (optimistic UI)
                    habitUpdates.forEach(u => {
                        const h = habits.find(h => h.id === u.id);
                        if (h) { h.position = u.position; h.divider_id = u.divider_id; }
                    });
                    dividerUpdates.forEach(u => {
                        const d = dividers.find(d => d.id === u.id);
                        if (d) d.position = u.position;
                    });

                    // Persist to Supabase
                    await updateAllPositions(habitUpdates, dividerUpdates);
                } catch (e) {
                    console.error('Drag end error:', e);
                    // Re-render from local state if something went wrong
                    renderTable();
                }
            }
        });

        console.log('✅ Drag-and-drop initialized (divider-aware)');
    } catch (e) {
        console.warn('Drag-and-drop init failed:', e);
    }
}

// ─── Analytics ─────────────────────────────────────────────────────────────
function updateAnalytics() {
    try {
        const stats = habits.map(habit => {
            const createdDate = new Date(habit.created_at);
            const createdDay  = createdDate.getDate();
            const isThisMonth = createdDate.getFullYear() === selectedYear
                             && createdDate.getMonth()    === selectedMonth;
            const startDay    = isThisMonth ? createdDay : 1;

            // Respect end_date
            let endDay = daysInMonth;
            if (habit.end_date) {
                const ed = new Date(habit.end_date + 'T00:00:00');
                if (ed.getFullYear() === selectedYear && ed.getMonth() === selectedMonth) {
                    endDay = ed.getDate();
                }
            }

            // Only count scheduled days (frequency-aware)
            let validDays = 0;
            let score = 0;
            for (let d = startDay; d <= endDay; d++) {
                if (!isScheduledDay(habit, selectedYear, selectedMonth, d)) continue;
                validDays++;
                score += (completions[`${habit.id}-${d}`] || 0) / 100;
            }
            const pct = validDays > 0 ? (score / validDays) * 100 : 0;
            return { name: habit.name, score, pct, validDays };
        });

        if (stats.length === 0) {
            document.getElementById('overallVal').textContent  = '0%';
            document.getElementById('bestName').textContent     = 'No habits yet';
            document.getElementById('worstName').textContent    = 'Add habits to start';
            return;
        }

        const totalScore    = stats.reduce((s, x) => s + x.score, 0);
        const totalPossible = stats.reduce((s, x) => s + x.validDays, 0);
        const overallPct    = totalPossible > 0
            ? ((totalScore / totalPossible) * 100).toFixed(1)
            : 0;

        document.getElementById('overallVal').textContent = overallPct + '%';

        const sorted = [...stats].sort((a, b) => b.pct - a.pct);
        const best   = sorted[0];
        const worst  = sorted[sorted.length - 1];

        document.getElementById('bestName').textContent   = best.name;
        document.getElementById('bestScore').textContent  = `${best.pct.toFixed(1)}% avg`;
        document.getElementById('worstName').textContent  = worst.name;
        document.getElementById('worstScore').textContent = `${worst.pct.toFixed(1)}% avg`;

        // Line chart — per-day average completion % (frequency-aware)
        const dailyPerf = Array.from({ length: daysInMonth }, (_, i) => {
            const day = i + 1;
            const dayHabits = habits.filter(h => {
                const cd = new Date(h.created_at);
                if (cd.getFullYear() === selectedYear && cd.getMonth() === selectedMonth
                        && day < cd.getDate()) return false;
                if (h.end_date) {
                    const ed = new Date(h.end_date + 'T00:00:00');
                    if (ed.getFullYear() === selectedYear && ed.getMonth() === selectedMonth
                            && day > ed.getDate()) return false;
                }
                // Only include if this day is scheduled for the habit
                return isScheduledDay(h, selectedYear, selectedMonth, day);
            });
            if (dayHabits.length === 0) return 0;
            const total = dayHabits.reduce((sum, h) => sum + (completions[`${h.id}-${day}`] || 0), 0);
            return total / dayHabits.length;
        });

        if (charts.lineChart) charts.lineChart.destroy();
        const _cs = getComputedStyle(document.documentElement);
        const _pri = _cs.getPropertyValue('--primary').trim() || '#4f46e5';
        const _suc = _cs.getPropertyValue('--success').trim() || '#10b981';
        const _dan = _cs.getPropertyValue('--danger').trim() || '#ef4444';
        charts.lineChart = new Chart(document.getElementById('lineChart'), {
            type: 'line',
            data: {
                labels: Array.from({ length: daysInMonth }, (_, i) => i + 1),
                datasets: [{ data: dailyPerf, borderColor: _pri, tension: 0.4,
                    fill: true, backgroundColor: _pri + '0D', pointRadius: 2 }]
            },
            options: { maintainAspectRatio: false, plugins: { legend: { display: false } },
                scales: { y: { min: 0, max: 100, ticks: { callback: v => v + '%' } },
                          x: { grid: { display: false } } } }
        });

        if (charts.pieChart) charts.pieChart.destroy();
        charts.pieChart = new Chart(document.getElementById('pieChart'), {
            type: 'doughnut',
            data: { labels: ['Done','Left'], datasets: [{
                data: [
                    parseFloat(totalScore.toFixed(2)),
                    parseFloat((totalPossible - totalScore).toFixed(2))
                ],
                backgroundColor: [_suc, '#f1f5f9'], borderWidth: 0 }] },
            options: { maintainAspectRatio: false, cutout: '70%',
                plugins: { legend: { position: 'bottom' } } }
        });

        const top5Best = sorted.slice(0, 5);
        if (charts.bestChart) charts.bestChart.destroy();
        charts.bestChart = new Chart(document.getElementById('bestChart'), {
            type: 'bar',
            data: {
                labels: top5Best.map(s => s.name.length > 15 ? s.name.substring(0,15)+'…' : s.name),
                datasets: [{ data: top5Best.map(s => parseFloat(s.pct.toFixed(1))),
                             backgroundColor: _suc, borderRadius: 4 }]
            },
            options: { indexAxis: 'y', maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: { x: { min: 0, max: 100, ticks: { callback: v => v + '%' } } } }
        });

        const top5Worst = [...sorted].reverse().slice(0, 5);
        if (charts.worstChart) charts.worstChart.destroy();
        charts.worstChart = new Chart(document.getElementById('worstChart'), {
            type: 'bar',
            data: {
                labels: top5Worst.map(s => s.name.length > 15 ? s.name.substring(0,15)+'…' : s.name),
                datasets: [{ data: top5Worst.map(s => parseFloat(s.pct.toFixed(1))),
                             backgroundColor: _dan, borderRadius: 4 }]
            },
            options: { indexAxis: 'y', maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: { x: { min: 0, max: 100, ticks: { callback: v => v + '%' } } } }
        });
    } catch (e) { console.error('Analytics error:', e); }
}

// ═══════════════════════════════════════════════════════════════════
// WEEKLY ANALYTICS  (sidebar charts)
// ═══════════════════════════════════════════════════════════════════
// Now that tasks are per-week, the denominator is derived from how many
// tasks actually existed each week (via week_start), not a global count.

async function updateWeeklyAnalytics() {
    try {
        const now = new Date();
        const months = Array.from({ length: 4 }, (_, i) => {
            const d = new Date(now.getFullYear(), now.getMonth() - (3 - i), 1);
            return { year: d.getFullYear(), month: d.getMonth() };
        });

        const rangeStart    = new Date(months[0].year, months[0].month, 1);
        const rangeEnd      = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        const rangeStartStr = toDateStr(rangeStart);
        const rangeEndStr   = toDateStr(rangeEnd);

        // Fetch all task definitions in the date range
        const { data: taskData, error: taskErr } = await supabaseClient
            .from('weekly_tasks')
            .select('id, week_start')
            .eq('user_id', currentUser.id)
            .gte('week_start', rangeStartStr)
            .lte('week_start', rangeEndStr);

        // Fetch all completions in the range — now includes completion_percentage
        const { data: compData, error: compErr } = await supabaseClient
            .from('weekly_task_completions')
            .select('task_id, completion_date, completion_percentage')
            .eq('user_id', currentUser.id)
            .gte('completion_date', rangeStartStr)
            .lte('completion_date', rangeEndStr);

        if (compErr) { console.warn('Weekly analytics fetch failed:', compErr.message); return; }

        // Helper: month key string
        function monthKey(dateStr) {
            const d = new Date(dateStr + 'T00:00:00');
            return `${d.getFullYear()}-${d.getMonth()}`;
        }

        // Build week_start → task_count map (possible slots per week)
        const tasksByWeek = {};   // weekStr → count of tasks
        const taskWeekMap = {};   // task_id  → week_start
        (taskData || []).forEach(t => {
            if (!t.week_start) return;
            tasksByWeek[t.week_start] = (tasksByWeek[t.week_start] || 0) + 1;
            taskWeekMap[t.id] = t.week_start;
        });

        // Sum possible completions per calendar month
        const possibleByMonth = {};
        Object.entries(tasksByWeek).forEach(([ws, cnt]) => {
            const mk = monthKey(ws);
            possibleByMonth[mk] = (possibleByMonth[mk] || 0) + cnt;
        });

        // Weighted done score per month: 50% task = 0.5 contribution
        const doneByMonth = {};
        (compData || []).forEach(c => {
            const ws  = taskWeekMap[c.task_id] || c.completion_date;
            const mk  = monthKey(ws);
            const pct = (c.completion_percentage || 100) / 100;   // 0.0–1.0
            doneByMonth[mk] = (doneByMonth[mk] || 0) + pct;
        });

        const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const monthStats = months.map(({ year, month }) => {
            const mk       = `${year}-${month}`;
            const possible = possibleByMonth[mk] || 0;
            const done     = doneByMonth[mk]     || 0;           // weighted 0.0–N
            const missed   = Math.max(0, possible - done);
            const pct      = possible > 0 ? Math.round((done / possible) * 100) : 0;
            return { label: MONTH_NAMES[month], done, missed, possible, pct };
        });

        const cur = monthStats[monthStats.length - 1];

        // Show weighted score rounded to 1 dp (e.g. "3.5 of 5")
        const doneLabel   = cur.possible === 0 ? '—' : parseFloat(cur.done.toFixed(1));
        const missedLabel = cur.possible === 0 ? '—' : parseFloat(cur.missed.toFixed(1));
        document.getElementById('wtDoneVal').textContent   = doneLabel;
        document.getElementById('wtMissedVal').textContent = missedLabel;

        // ── BUG FIX: Always render charts, even with empty current month ──
        // Check if ANY month in the range has data (not just current month)
        const anyData = monthStats.some(m => m.possible > 0);

        // Theme-aware colors
        const _wcs = getComputedStyle(document.documentElement);
        const _wsuc = _wcs.getPropertyValue('--success').trim() || '#10b981';
        const _wsec = _wcs.getPropertyValue('--secondary').trim() || '#8b5cf6';

        if (charts.wtDonutChart) charts.wtDonutChart.destroy();
        if (cur.possible > 0) {
            charts.wtDonutChart = new Chart(document.getElementById('wtDonutChart'), {
                type: 'doughnut',
                data: {
                    labels: ['Done', 'Missed'],
                    datasets: [{
                        data: [
                            parseFloat(cur.done.toFixed(2)),
                            parseFloat(cur.missed.toFixed(2))
                        ],
                        backgroundColor: [_wsuc, '#fee2e2'],
                        borderColor:     [_wsuc, '#fca5a5'],
                        borderWidth: 1
                    }]
                },
                options: {
                    maintainAspectRatio: false, cutout: '70%',
                    plugins: {
                        legend: { position: 'bottom', labels: { font: { size: 10 } } },
                        tooltip: { callbacks: { label: ctx => ` ${parseFloat(ctx.parsed.toFixed(1))} task equiv.` } }
                    }
                }
            });
        } else {
            // Empty donut with "No data" label
            charts.wtDonutChart = new Chart(document.getElementById('wtDonutChart'), {
                type: 'doughnut',
                data: {
                    labels: ['No data yet'],
                    datasets: [{ data: [1], backgroundColor: ['#f1f5f9'], borderWidth: 0 }]
                },
                options: {
                    maintainAspectRatio: false, cutout: '70%',
                    plugins: {
                        legend: { position: 'bottom', labels: { font: { size: 10 } } },
                        tooltip: { enabled: false }
                    }
                }
            });
        }

        // Bar chart always renders — shows all 4 months regardless
        if (charts.wtBarChart) charts.wtBarChart.destroy();
        charts.wtBarChart = new Chart(document.getElementById('wtBarChart'), {
            type: 'bar',
            data: {
                labels: monthStats.map(m => m.label),
                datasets: [{
                    label: '% Done',
                    data:  monthStats.map(m => m.pct),
                    backgroundColor: monthStats.map((m, i) =>
                        i === monthStats.length - 1 ? _wsec : (_wsec + '66')
                    ),
                    borderRadius: 4,
                    barPercentage: 0.6
                }]
            },
            options: {
                maintainAspectRatio: false,
                plugins: { legend: { display: false },
                    tooltip: { callbacks: { label: ctx => ` ${ctx.parsed.y}%` } }
                },
                scales: {
                    y: { min: 0, max: 100, ticks: { callback: v => v + '%', font: { size: 9 } } },
                    x: { grid: { display: false }, ticks: { font: { size: 10 } } }
                }
            }
        });

    } catch (e) {
        console.error('updateWeeklyAnalytics error:', e);
    }
}

// ═══════════════════════════════════════════════════════════════════
// WEEKLY TRACKER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════

// Returns a new Date set to the Monday of the week containing `date`
function getMonday(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    const day = d.getDay(); // 0=Sun … 6=Sat
    d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
    return d;
}

// "YYYY-MM-DD" string from a Date (local time, no UTC shift)
function toDateStr(date) {
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}

// Is the given weekStart the current real-world week?
function isCurrentWeek(ws) {
    return toDateStr(ws) === toDateStr(getMonday(new Date()));
}

// Is the weekStart in the future?
function isFutureWeek(ws) {
    return ws > getMonday(new Date());
}

// Week navigation
function changeWeek(delta) {
    weekStart = new Date(weekStart);
    weekStart.setDate(weekStart.getDate() + delta * 7);
    loadWeeklyTasks();
}

function goToCurrentWeek() {
    weekStart = getMonday(new Date());
    loadWeeklyTasks();
}

// Update the "Mar 17 – Mar 23, 2026" label + column header
function updateWeekLabel() {
    const sun = new Date(weekStart);
    sun.setDate(sun.getDate() + 6);
    const opts = { month: 'short', day: 'numeric' };
    const start = weekStart.toLocaleDateString('en-US', opts);
    const end   = sun.toLocaleDateString('en-US', { ...opts, year: 'numeric' });
    document.getElementById('weekLabel').textContent = `${start} – ${end}`;

    // Column header: "This Week ✦" for current, date range for past/future
    const hdr = document.getElementById('weekStatusHeader');
    if (hdr) {
        if (isCurrentWeek(weekStart)) {
            hdr.innerHTML = '<span class="wt-current-week-label">✦ This Week</span>';
        } else if (isFutureWeek(weekStart)) {
            hdr.textContent = 'Upcoming';
        } else {
            hdr.textContent = `${start} – ${sun.toLocaleDateString('en-US', opts)}`;
        }
    }
}

// ── Load weekly data ──────────────────────────────────────────────────────
async function loadWeeklyTasks() {
    try {
        updateWeekLabel();
        const weekStartStr = toDateStr(weekStart);

        // ── Toggle UI based on week type ────────────────────────────────────
        const isPast    = !isCurrentWeek(weekStart) && !isFutureWeek(weekStart);
        const addBtn    = document.getElementById('wtAddTaskBtn');
        const notice    = document.getElementById('wtArchivedNotice');
        if (addBtn)  addBtn.style.display  = isPast ? 'none' : '';
        if (notice)  notice.style.display  = isPast ? ''     : 'none';

        // Fetch tasks scoped ONLY to the viewed week via week_start column
        const { data: taskData, error: taskErr } = await supabaseClient
            .from('weekly_tasks')
            .select('*')
            .eq('user_id', currentUser.id)
            .eq('week_start', weekStartStr)        // ← per-week scope
            .order('position', { ascending: true, nullsFirst: false });

        if (taskErr) {
            console.warn('⚠️ weekly_tasks table may not exist yet:', taskErr.message);
            weeklyTasks = [];
            renderWeeklyTable();
            return;
        }
        weeklyTasks = taskData || [];

        // Fetch completions for this specific week only — now includes percentage
        const { data: compData, error: compErr } = await supabaseClient
            .from('weekly_task_completions')
            .select('task_id, completion_date, completion_percentage')
            .eq('user_id', currentUser.id)
            .eq('completion_date', weekStartStr);

        weeklyCompletions = {};
        if (!compErr) {
            (compData || []).forEach(c => {
                // Store the actual percentage (old rows without column → default 100)
                weeklyCompletions[c.task_id] = c.completion_percentage || 100;
            });
        }

        renderWeeklyTable();
        updateWeeklyAnalytics();
    } catch (e) {
        console.error('loadWeeklyTasks error:', e);
    }
}

// ── Render the weekly table (3 columns: task | checkbox | actions) ─────────
function renderWeeklyTable() {
    const body = document.getElementById('weeklyBody');
    if (!body) return;
    body.innerHTML = '';

    const currentWeek  = isCurrentWeek(weekStart);
    const futureWeek   = isFutureWeek(weekStart);
    const pastWeek     = !currentWeek && !futureWeek;
    const weekStartStr = toDateStr(weekStart);

    if (weeklyTasks.length === 0) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 3;
        td.innerHTML = pastWeek
            ? `<div class="wt-empty"><span class="wt-empty-icon">📂</span>No tasks were recorded for this week.</div>`
            : `<div class="wt-empty"><span class="wt-empty-icon">📋</span>No tasks this week — click <strong>+ Add Task</strong> to add one.</div>`;
        tr.appendChild(td);
        body.appendChild(tr);
        return;
    }

    weeklyTasks.forEach(task => {
        const pct  = weeklyCompletions[task.id] || 0;   // 0–100
        const done = pct >= 100;
        const tr   = document.createElement('tr');
        tr.dataset.taskId = task.id;

        // Only active (current/future) weeks get drag handles
        if (!pastWeek) tr.className = 'wt-draggable';
        if (pastWeek)  tr.classList.add('wt-row-past');

        // Task name cell
        const tdName = document.createElement('td');
        tdName.className = 'wt-task-col';
        const dragHandle = (!pastWeek && typeof Sortable !== 'undefined')
            ? '<span class="drag-handle" style="margin-right:8px;color:var(--text-sub);">☰</span>'
            : '';
        tdName.innerHTML = `${dragHandle}<span title="${escapeHtml(task.name)}">${escapeHtml(task.name)}</span>`;
        tr.appendChild(tdName);

        // Status cell
        const tdDone = document.createElement('td');
        tdDone.className = 'wt-cb-cell';

        if (currentWeek) {
            // Interactive pct-cell — same design as daily habits
            const wrapper = document.createElement('div');
            wrapper.className = 'wt-pct-wrapper';
            wrapper.appendChild(buildPctCell(pct));
            wrapper.onclick = (e) => {
                e.stopPropagation();
                openWeeklyPctPopover(task.id, weekStartStr, pct, tdDone);
            };
            tdDone.appendChild(wrapper);
        } else if (futureWeek) {
            tdDone.innerHTML = '<span class="wt-done-badge future">—</span>';
        } else {
            // Past week: read-only percentage badge
            if (pct >= 100) {
                tdDone.innerHTML = '<span class="wt-done-badge done">✓ Done</span>';
            } else if (pct > 0) {
                tdDone.innerHTML = `<span class="wt-done-badge partial">${pct}%</span>`;
            } else {
                tdDone.innerHTML = '<span class="wt-done-badge missed">✗ Missed</span>';
            }
        }
        tr.appendChild(tdDone);

        // Actions cell — edit + delete only on current/future weeks
        const tdAct = document.createElement('td');
        tdAct.className = 'wt-act-col';
        if (!pastWeek) {
            tdAct.innerHTML = `
                <button class="action-btn edit-btn" onclick="openWeeklyTaskModal('${task.id}')">Edit</button>
                <button class="action-btn delete-btn" onclick="deleteWeeklyTask('${task.id}')">Del</button>`;
        } else {
            tdAct.innerHTML = '<span style="font-size:9px;color:var(--text-sub);">Archived</span>';
        }
        tr.appendChild(tdAct);

        body.appendChild(tr);
    });

    // Only enable drag-and-drop on editable weeks
    if (!pastWeek) initWeeklyDragAndDrop();
}

// ── Drag-and-drop for weekly tasks ────────────────────────────────────────
let weeklySortable = null;
function initWeeklyDragAndDrop() {
    if (typeof Sortable === 'undefined') return;
    const body = document.getElementById('weeklyBody');
    if (!body || body.querySelector('.wt-empty')) return;
    if (weeklySortable) weeklySortable.destroy();
    weeklySortable = new Sortable(body, {
        animation: 150,
        handle: '.drag-handle',
        ghostClass: 'wt-sortable-ghost',
        onEnd: async function() {
            const rows = Array.from(body.children);
            const updates = rows.map((row, index) =>
                supabaseClient.from('weekly_tasks')
                    .update({ position: index })
                    .eq('id', row.dataset.taskId)
                    .eq('user_id', currentUser.id)
            );
            const results = await Promise.all(updates);
            const errs = results.filter(r => r.error);
            if (errs.length) { console.error('Weekly reorder error:', errs[0].error); await loadWeeklyTasks(); }
            else {
                // Update local order
                const ordered = rows.map(r => weeklyTasks.find(t => t.id === r.dataset.taskId));
                weeklyTasks = ordered;
            }
        }
    });
}

// ── Set a weekly task completion percentage (auto-saves) ──────────────────
async function setWeeklyTaskPct(taskId, weekStartStr, pct) {
    pct = Math.max(0, Math.min(100, Math.round(pct)));

    // Optimistic update
    if (pct === 0) { delete weeklyCompletions[taskId]; }
    else           { weeklyCompletions[taskId] = pct; }
    renderWeeklyTable();

    try {
        // Delete any existing completion row first (clean-slate approach)
        await supabaseClient
            .from('weekly_task_completions')
            .delete()
            .eq('task_id', taskId)
            .eq('completion_date', weekStartStr)
            .eq('user_id', currentUser.id);

        // Re-insert if non-zero
        if (pct > 0) {
            const { error } = await supabaseClient
                .from('weekly_task_completions')
                .insert({ task_id: taskId, user_id: currentUser.id,
                          completion_date: weekStartStr, completion_percentage: pct });
            if (error) throw error;
        }

        updateWeeklyAnalytics();
    } catch (e) {
        // Rollback on failure
        if (pct === 0) { weeklyCompletions[taskId] = 100; } // restore default
        else           { delete weeklyCompletions[taskId]; }
        renderWeeklyTable();
        alert('Failed to save: ' + e.message);
    }
}

// ── Open the shared popover for a weekly task ──────────────────────────────
function openWeeklyPctPopover(taskId, weekStartStr, currentPct, tdEl) {
    _popMode         = 'weekly';
    _popWeeklyTaskId = taskId;
    _popWeekStr      = weekStartStr;
    // Clear daily-habit popover state so there's no cross-contamination
    _popHabitId = null;
    _popDay     = null;

    const task = weeklyTasks.find(t => t.id === taskId);
    document.getElementById('popTitle').textContent =
        `${task ? task.name : '–'}  ·  Week of ${weekStartStr}`;

    document.getElementById('pctManualInput').value = currentPct;
    document.getElementById('popActual').value  = '';
    document.getElementById('popTarget').value  = '';

    // Highlight matching quick button
    document.querySelectorAll('.pop-qbtn[data-pct]').forEach(btn => {
        btn.classList.toggle('is-active', parseInt(btn.dataset.pct) === currentPct);
    });

    // Position popover near the cell
    const pop  = document.getElementById('pctPopover');
    pop.style.display = 'block';
    const rect = tdEl.getBoundingClientRect();
    const pw   = pop.offsetWidth  || 230;
    const ph   = pop.offsetHeight || 260;

    let top  = rect.bottom + 5;
    let left = rect.left - pw / 2 + rect.width / 2;
    if (top + ph > window.innerHeight - 10) top = rect.top - ph - 5;
    if (left + pw > window.innerWidth  - 8) left = window.innerWidth - pw - 8;
    if (left < 8) left = 8;

    pop.style.top  = top  + 'px';
    pop.style.left = left + 'px';
}

// ── History modal ─────────────────────────────────────────────────────────
async function openHistoryModal() {
    document.getElementById('historyModal').classList.add('active');
    document.getElementById('historyContent').innerHTML =
        '<p class="history-empty">Loading…</p>';

    try {
        // Fetch ALL task definitions for this user (all weeks, ordered newest first)
        const { data: allTasks, error: taskErr } = await supabaseClient
            .from('weekly_tasks')
            .select('id, name, week_start')
            .eq('user_id', currentUser.id)
            .order('week_start', { ascending: false });

        if (taskErr) throw taskErr;

        // Fetch ALL completions for this user — now with percentage
        const { data: allComps, error: compErr } = await supabaseClient
            .from('weekly_task_completions')
            .select('task_id, completion_date, completion_percentage')
            .eq('user_id', currentUser.id);

        if (compErr) throw compErr;

        if (!allTasks || allTasks.length === 0) {
            document.getElementById('historyContent').innerHTML =
                '<p class="history-empty">No tasks recorded yet. Add some tasks this week to get started!</p>';
            return;
        }

        // Build a map: task_id → completion_percentage (0 = no entry)
        const compMap = {};
        (allComps || []).forEach(c => {
            compMap[c.task_id] = c.completion_percentage || 100;
        });

        // Group tasks by their week_start (legacy tasks without week_start → current week)
        const currentWeekStr = toDateStr(getMonday(new Date()));
        const weekGroups = {};   // weekStr → [task, ...]
        (allTasks || []).forEach(t => {
            const ws = t.week_start || currentWeekStr;
            if (!weekGroups[ws]) weekGroups[ws] = [];
            weekGroups[ws].push(t);
        });

        // Sort weeks newest-first
        const sortedWeeks = Object.keys(weekGroups).sort().reverse();

        let html = '';
        sortedWeeks.forEach(ws => {
            const monday = new Date(ws + 'T00:00:00');
            const sunday = new Date(monday);
            sunday.setDate(monday.getDate() + 6);
            const label = `${monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${sunday.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
            const isNow = ws === currentWeekStr;

            const tasks     = weekGroups[ws];
            // Weighted done count for this week
            const doneScore = tasks.reduce((sum, t) => sum + (compMap[t.id] ? compMap[t.id] / 100 : 0), 0);
            const doneLabel = `${parseFloat(doneScore.toFixed(1))}/${tasks.length} done`;

            html += `<div class="hw-week-block">
                <div class="hw-week-header">
                    <span>${label}</span>
                    ${isNow ? '<span class="hw-now-badge">This Week</span>' : ''}
                    <span style="margin-left:auto;font-size:10px;color:var(--text-sub);font-weight:600;">${doneLabel}</span>
                </div>
                <div class="hw-task-list">`;

            tasks.forEach(t => {
                const pct = compMap[t.id] || 0;
                let statusHtml;
                if (pct >= 100) {
                    statusHtml = '<span class="hw-check">✓</span>';
                } else if (pct > 0) {
                    statusHtml = `<span style="font-size:11px;font-weight:700;color:#92400e;background:#fef3c7;border:1px solid #fde68a;padding:1px 5px;border-radius:4px;">${pct}%</span>`;
                } else {
                    statusHtml = '<span class="hw-cross">—</span>';
                }
                html += `<div class="hw-task-row">
                    <span>${statusHtml}</span>
                    <span class="hw-task-name${pct === 0 ? ' missed' : ''}">${escapeHtml(t.name)}</span>
                </div>`;
            });

            html += `</div></div>`;
        });

        document.getElementById('historyContent').innerHTML = html;

    } catch (e) {
        document.getElementById('historyContent').innerHTML =
            `<p class="history-empty">Failed to load history: ${e.message}</p>`;
    }
}

function closeHistoryModal() {
    document.getElementById('historyModal').classList.remove('active');
}

// ── Weekly task CRUD ──────────────────────────────────────────────────────
function openWeeklyTaskModal(taskId = null) {
    editingWeeklyTaskId = taskId;
    const modal = document.getElementById('weeklyTaskModal');
    const input = document.getElementById('weeklyTaskName');
    document.getElementById('weeklyTaskModalTitle').textContent =
        taskId ? 'Edit Weekly Task' : 'Add Weekly Task';
    if (taskId) {
        const task = weeklyTasks.find(t => t.id === taskId);
        input.value = task ? task.name : '';
    } else {
        input.value = '';
    }
    modal.classList.add('active');
    input.focus();
}

function closeWeeklyTaskModal() {
    document.getElementById('weeklyTaskModal').classList.remove('active');
    editingWeeklyTaskId = null;
}

async function saveWeeklyTask() {
    try {
        const name = document.getElementById('weeklyTaskName').value.trim();
        if (!name) { alert('Please enter a task name'); return; }

        const weekStartStr = toDateStr(weekStart);

        if (editingWeeklyTaskId) {
            // Edit — only the name changes; week_start is immutable
            const { error } = await supabaseClient
                .from('weekly_tasks')
                .update({ name })
                .eq('id', editingWeeklyTaskId)
                .eq('user_id', currentUser.id);
            if (error) throw error;
        } else {
            // New task — stamped to the currently viewed week
            const maxPos = weeklyTasks.length > 0
                ? Math.max(...weeklyTasks.map(t => t.position ?? 0)) : -1;
            const { error } = await supabaseClient
                .from('weekly_tasks')
                .insert({ name, user_id: currentUser.id, position: maxPos + 1,
                          week_start: weekStartStr });   // ← scoped to this week only
            if (error) throw error;
        }
        closeWeeklyTaskModal();
        await loadWeeklyTasks();
    } catch (e) { alert('Failed to save task: ' + e.message); }
}

async function deleteWeeklyTask(taskId) {
    // Each task row is scoped to one week via week_start.
    // Deleting this row only removes it from this week — past weeks have their own rows.
    if (!confirm('Remove this task from this week? Past history is unaffected.')) return;
    try {
        const { error } = await supabaseClient
            .from('weekly_tasks').delete()
            .eq('id', taskId).eq('user_id', currentUser.id);
        if (error) throw error;
        await loadWeeklyTasks();
    } catch (e) { alert('Failed to delete task: ' + e.message); }
}

// ─── Utility ───────────────────────────────────────────────────────────────
function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── Boot ──────────────────────────────────────────────────────────────────

// Listen for Supabase auth events.
// PASSWORD_RECOVERY fires when the user arrives via the reset-password email link.
supabaseClient.auth.onAuthStateChange((event, _session) => {
    if (event === 'PASSWORD_RECOVERY') {
        showResetPasswordForm();
    }
});

(async () => {
    try {
        // Check whether the URL hash carries a recovery token.
        // Supabase appends  #access_token=...&type=recovery  to the redirect URL.
        const hashParams = new URLSearchParams(window.location.hash.slice(1));
        if (hashParams.get('type') === 'recovery') {
            // Let getSession() exchange the token; onAuthStateChange will then
            // fire PASSWORD_RECOVERY and call showResetPasswordForm().
            await supabaseClient.auth.getSession();
            return;
        }

        const { data: { session }, error } = await supabaseClient.auth.getSession();
        if (error) { console.error('Auth check error:', error); return; }
        if (session) { currentUser = session.user; await initApp(); }
    } catch (e) { console.error('Auth init error:', e); }
})();

// ═══════════════════════════════════════════════════════════════════════════
// STATIC EVENT LISTENERS
// ───────────────────────────────────────────────────────────────────────────
// All inline `onclick="…"` / `onkeydown="…"` / `oninput="…"` handlers from the
// original single-file build have been moved here. The functions themselves
// are unchanged; only the wire-up mechanism has changed (HTML attribute →
// addEventListener). The script is loaded with `defer`, so by the time this
// runs the DOM is fully parsed and every element exists.
// ═══════════════════════════════════════════════════════════════════════════
function _initStaticEventListeners() {
    const on = (id, ev, fn) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener(ev, fn);
    };

    // ── Auth: login form ───────────────────────────────────────────────────
    on('loginPassword', 'keydown', e => { if (e.key === 'Enter') login(); });
    on('loginBtn',           'click', login);
    on('forgotLink',         'click', switchToForgotPassword);
    on('loginToggleSignup',  'click', switchToSignup);

    // ── Auth: signup form ──────────────────────────────────────────────────
    on('signupBtn',          'click', signup);
    on('signupToggleLogin',  'click', switchToLogin);

    // ── Auth: forgot-password form ─────────────────────────────────────────
    on('forgotEmail', 'keydown', e => { if (e.key === 'Enter') requestPasswordReset(); });
    on('forgotBtn',          'click', requestPasswordReset);
    on('forgotToggleLogin',  'click', switchToLogin);

    // ── Auth: reset-password form ──────────────────────────────────────────
    on('newPassword', 'input',   e => checkPasswordStrength(e.target.value));
    on('newPassword', 'keydown', e => { if (e.key === 'Enter') resetPassword(); });
    on('confirmPassword', 'keydown', e => { if (e.key === 'Enter') resetPassword(); });
    on('resetBtn', 'click', resetPassword);

    // ── Sidebar header / overlay ──────────────────────────────────────────
    on('sidebarOverlay',   'click', closeSidebar);
    on('logoutBtn',        'click', logout);
    on('sidebarCloseBtn',  'click', closeSidebar);

    // ── Month navigation ───────────────────────────────────────────────────
    on('monthPrevBtn',  'click', () => changeMonth(-1));
    on('monthTodayBtn', 'click', goToCurrentMonth);
    on('monthNextBtn',  'click', () => changeMonth(1));

    // ── Topbar ─────────────────────────────────────────────────────────────
    on('sidebarToggle',   'click', toggleSidebar);
    on('themeTrigger',    'click', toggleThemeDropdown);
    on('themeApplyBtn',   'click', applyCustomTheme);
    on('quoteExpandBtn',  'click', expandQuote);

    // ── Daily quote strip ─────────────────────────────────────────────────
    on('quoteHideBtn', 'click', collapseQuote);

    // ── Save / discard bar ─────────────────────────────────────────────────
    on('discardBtn', 'click', discardChanges);
    on('saveBtn',    'click', saveAllChanges);

    // ── Pending Today card (header click toggles collapsed state) ─────────
    on('pendingTop', 'click', togglePendingSection);

    // ── Daily Habits section header buttons ────────────────────────────────
    on('addSectionBtn', 'click', () => openDividerModal());
    on('addHabitBtn',   'click', () => openHabitModal());

    // ── Weekly Tasks header buttons ────────────────────────────────────────
    on('weekPrevBtn',    'click', () => changeWeek(-1));
    on('weekNextBtn',    'click', () => changeWeek(1));
    on('weekTodayBtn',   'click', goToCurrentWeek);
    on('weekHistoryBtn', 'click', openHistoryModal);
    on('wtAddTaskBtn',   'click', () => openWeeklyTaskModal());

    // ── Habit modal: frequency-type & specific-day buttons ────────────────
    document.querySelectorAll('#freqSelector .freq-type-btn').forEach(btn => {
        btn.addEventListener('click', () => setFreqType(btn.dataset.freq));
    });
    document.querySelectorAll('#freqSelector .freq-day-btn').forEach(btn => {
        btn.addEventListener('click', () => toggleFreqDay(btn));
    });

    // ── Habit modal: action buttons ────────────────────────────────────────
    on('habitModalCancelBtn', 'click', closeHabitModal);
    on('habitModalSaveBtn',   'click', saveHabit);

    // ── Divider modal ──────────────────────────────────────────────────────
    on('dividerModalCancelBtn', 'click', closeDividerModal);
    on('dividerModalSaveBtn',   'click', saveDivider);

    // ── Delete-habit modal ─────────────────────────────────────────────────
    on('removeHabitFromMonthBtn', 'click', removeHabitFromMonth);
    on('deleteHabitForeverBtn',   'click', deleteHabitForever);
    on('deleteHabitModalCancelBtn', 'click', closeDeleteHabitModal);

    // ── History modal ──────────────────────────────────────────────────────
    on('historyCloseBtn', 'click', closeHistoryModal);

    // ── Weekly-task modal ──────────────────────────────────────────────────
    on('weeklyTaskModalCancelBtn', 'click', closeWeeklyTaskModal);
    on('weeklyTaskModalSaveBtn',   'click', saveWeeklyTask);

    // ── Partial-completion popover ─────────────────────────────────────────
    on('popCloseBtn', 'click', closePctPopover);
    document.querySelectorAll('#pctPopover .pop-qbtn').forEach(btn => {
        const pct = parseInt(btn.dataset.pct, 10) || 0;
        btn.addEventListener('click', () => applyPct(pct));
    });
    on('popActual',       'input',   syncTimeToManual);
    on('popTimeCalcBtn',  'click',   applyTimePct);
    on('popStepDownBtn',  'click', () => stepManual(-5));
    on('popStepUpBtn',    'click', () => stepManual(5));
    on('pctManualInput',  'keydown', e => { if (e.key === 'Enter') applyManual(); });
    on('popSetBtn',       'click',   applyManual);
}

// `defer` on the <script> tag guarantees the DOM is parsed by now.
_initStaticEventListeners();
