// ============================================
// NAZ interactive in-chat tools
// Shared, stateful widgets that any member can control.
// ============================================

const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

const clampNumber = (value, min, max, fallback) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.min(max, Math.max(min, num));
};

const cleanText = (value, maxLength) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength);

const formatValue = value => {
    if (Array.isArray(value)) return value.join('، ');
    if (typeof value === 'boolean') return value ? 'مفعّل' : 'مطفأ';
    return String(value ?? '');
};

const CUSTOM_CONTROL_TYPES = ['display', 'progress', 'button', 'slider', 'toggle', 'input', 'note', 'list', 'timer'];
const CUSTOM_OP_TYPES = ['add', 'sub', 'set', 'toggle', 'clear', 'pop', 'push', 'random', 'reset'];

function defaultControlValue(control) {
    if (control.type === 'list') return [];
    if (control.type === 'toggle') return false;
    if (control.type === 'input' || control.type === 'note' || control.type === 'display') return '';
    if (control.type === 'timer') return clampNumber(control.seconds, 5, 7200, 60);
    if (control.type === 'slider') return clampNumber(control.min, -1e6, 1e6, 0);
    return 0;
}

/* ---------- safe calculator ---------- */

function tokenizeExpression(source) {
    const tokens = [];
    let index = 0;
    const isDigit = ch => ch >= '0' && ch <= '9';
    while (index < source.length) {
        const ch = source[index];
        if (ch === ' ') { index++; continue; }
        if (isDigit(ch) || ch === '.') {
            let buffer = '';
            while (index < source.length && (isDigit(source[index]) || source[index] === '.')) buffer += source[index++];
            const num = Number(buffer);
            if (!Number.isFinite(num)) throw new Error('bad number');
            tokens.push({ type: 'num', value: num });
            continue;
        }
        if ('+-*/%()'.includes(ch)) { tokens.push({ type: ch }); index++; continue; }
        throw new Error('unsupported character');
    }
    return tokens;
}

function parseExpression(tokens) {
    let left = parseTerm(tokens);
    while (tokens[0] && (tokens[0].type === '+' || tokens[0].type === '-')) {
        const op = tokens.shift().type;
        const right = parseTerm(tokens);
        left = op === '+' ? left + right : left - right;
    }
    return left;
}

function parseTerm(tokens) {
    let left = parseFactor(tokens);
    while (tokens[0] && (tokens[0].type === '*' || tokens[0].type === '/' || tokens[0].type === '%')) {
        const op = tokens.shift().type;
        const right = parseFactor(tokens);
        if (op === '*') left *= right;
        else if (op === '/') left /= right;
        else left %= right;
    }
    return left;
}

function parseFactor(tokens) {
    const token = tokens.shift();
    if (!token) throw new Error('unexpected end');
    if (token.type === 'num') return token.value;
    if (token.type === '-') return -parseFactor(tokens);
    if (token.type === '(') {
        const value = parseExpression(tokens);
        const close = tokens.shift();
        if (!close || close.type !== ')') throw new Error('missing parenthesis');
        return value;
    }
    throw new Error('unexpected token');
}

function evaluateExpression(source) {
    const cleaned = String(source || '').replace(/[×✕]/g, '*').replace(/[÷]/g, '/').replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
    if (!cleaned.trim()) return { ok: false, error: 'فارغ' };
    try {
        const value = parseExpression(tokenizeExpression(cleaned));
        if (!Number.isFinite(value)) return { ok: false, error: 'غير صالح' };
        const rounded = Math.round(value * 1e10) / 1e10;
        return { ok: true, value: String(rounded) };
    } catch {
        return { ok: false, error: 'صيغة غير صحيحة' };
    }
}

/* ---------- unit conversion ---------- */

const UNIT_TABLES = {
    length: { m: 1, km: 1000, cm: 0.01, mm: 0.001, mi: 1609.344, ft: 0.3048, in: 0.0254 },
    mass: { kg: 1, g: 0.001, lb: 0.45359237, oz: 0.028349523125 }
};
const TEMP_UNITS = ['C', 'F', 'K'];

function convertValue(category, from, to, value) {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return null;
    if (category === 'temp') {
        if (!TEMP_UNITS.includes(from) || !TEMP_UNITS.includes(to)) return null;
        const celsius = from === 'C' ? amount : from === 'F' ? (amount - 32) * 5 / 9 : amount - 273.15;
        if (to === 'C') return celsius;
        if (to === 'F') return celsius * 9 / 5 + 32;
        return celsius + 273.15;
    }
    const table = UNIT_TABLES[category];
    if (!table || !(from in table) || !(to in table)) return null;
    return amount * table[from] / table[to];
}

/* ---------- tool definitions ---------- */

const winLine = (board, mark) => {
    const lines = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
    return lines.some(line => line.every(index => board[index] === mark));
};

export const TOOL_KINDS = {
    calculator: {
        label: 'حاسبة',
        icon: 'fa-calculator',
        defaults: () => ({}),
        state: () => ({ expr: '', result: '', error: '' }),
        actions: ['press', 'clear', 'back'],
        render(config, state) {
            const keys = ['7', '8', '9', '/', '4', '5', '6', '*', '1', '2', '3', '-', '0', '.', '%', '+'];
            return `
                <div class="tool-calc-display">
                    <div class="tool-calc-expr">${esc(state.expr || '0')}</div>
                    <div class="tool-calc-result">${esc(state.error || state.result || '')}</div>
                </div>
                <div class="tool-calc-keys">
                    ${keys.map(key => `<button type="button" class="tool-key" data-tool-action="press" data-tool-value="${esc(key)}">${esc(key)}</button>`).join('')}
                    <button type="button" class="tool-key tool-key-wide tool-key-primary" data-tool-action="press" data-tool-value="=">=</button>
                    <button type="button" class="tool-key tool-key-warn" data-tool-action="back">⌫</button>
                    <button type="button" class="tool-key tool-key-warn" data-tool-action="clear">C</button>
                </div>`;
        }
    },
    counter: {
        label: 'عدّاد',
        icon: 'fa-plus-minus',
        defaults: () => ({ label: 'عدّاد', step: 1 }),
        state: config => ({ value: 0, step: clampNumber(config?.step, 1, 1000, 1) }),
        actions: ['inc', 'dec', 'reset'],
        render(config, state) {
            const step = clampNumber(state.step, 1, 1000, 1);
            return `
                <div class="tool-counter-value">${esc(state.value ?? 0)}</div>
                <div class="tool-row">
                    <button type="button" class="tool-key tool-key-primary" data-tool-action="dec">− ${step}</button>
                    <button type="button" class="tool-key" data-tool-action="reset">تصفير</button>
                    <button type="button" class="tool-key tool-key-primary" data-tool-action="inc">+ ${step}</button>
                </div>`;
        }
    },
    timer: {
        label: 'مؤقّت',
        icon: 'fa-stopwatch',
        defaults: () => ({ seconds: 60 }),
        state: config => ({ remaining: clampNumber(config?.seconds, 5, 7200, 60), endsAt: null, running: false }),
        actions: ['start', 'pause', 'reset', 'add'],
        render(config, state) {
            const remaining = state.running && state.endsAt
                ? Math.max(0, Math.round((state.endsAt - Date.now()) / 1000))
                : clampNumber(state.remaining, 0, 7200, 60);
            const minutes = String(Math.floor(remaining / 60)).padStart(2, '0');
            const seconds = String(remaining % 60).padStart(2, '0');
            return `
                <div class="tool-timer" data-tool-timer data-ends="${state.running && state.endsAt ? state.endsAt : ''}">
                    <div class="tool-timer-display">${minutes}:${seconds}</div>
                    <div class="tool-row">
                        <button type="button" class="tool-key tool-key-primary" data-tool-action="${state.running ? 'pause' : 'start'}">${state.running ? 'إيقاف مؤقت' : 'تشغيل'}</button>
                        <button type="button" class="tool-key" data-tool-action="reset">إعادة</button>
                        <button type="button" class="tool-key" data-tool-action="add" data-tool-value="60">+ دقيقة</button>
                    </div>
                </div>`;
        }
    },
    poll: {
        label: 'تصويت',
        icon: 'fa-square-poll-vertical',
        defaults: () => ({ question: 'تصويت', options: ['نعم', 'لا'] }),
        state: config => ({ votes: (config?.options || []).map(() => 0), voters: {} }),
        actions: ['vote'],
        render(config, state, ctx) {
            const options = config?.options || [];
            const votes = Array.isArray(state.votes) ? state.votes : options.map(() => 0);
            const total = votes.reduce((sum, value) => sum + (Number(value) || 0), 0) || 1;
            const myVote = state.voters ? state.voters[ctx.user] : undefined;
            return `
                <div class="tool-poll-question">${esc(config?.question || 'تصويت')}</div>
                <div class="tool-poll-options">
                    ${options.map((option, index) => {
                        const count = Number(votes[index]) || 0;
                        const percent = Math.round(count / total * 100);
                        return `<button type="button" class="tool-poll-option ${myVote === index ? 'is-mine' : ''}" data-tool-action="vote" data-tool-value="${index}">
                            <span class="tool-poll-bar" style="width:${percent}%"></span>
                            <span class="tool-poll-label">${esc(option)}</span>
                            <span class="tool-poll-count">${count} · ${percent}%</span>
                        </button>`;
                    }).join('')}
                </div>`;
        }
    },
    checklist: {
        label: 'قائمة مهام',
        icon: 'fa-list-check',
        defaults: () => ({ title: 'قائمة مهام', items: [] }),
        state: config => ({ items: (config?.items || []).map(text => ({ text, done: false })) }),
        actions: ['toggle', 'add', 'remove'],
        render(config, state) {
            const items = Array.isArray(state.items) ? state.items : [];
            return `
                <div class="tool-list">
                    ${items.length ? items.map((item, index) => `
                        <div class="tool-list-item ${item.done ? 'is-done' : ''}">
                            <button type="button" class="tool-list-toggle" data-tool-action="toggle" data-tool-value="${index}">${item.done ? '✓' : '○'}</button>
                            <span class="tool-list-text">${esc(item.text)}</span>
                            <button type="button" class="tool-list-remove" data-tool-action="remove" data-tool-value="${index}" aria-label="حذف">×</button>
                        </div>`).join('') : '<div class="tool-empty">القائمة فاضية، أضف أول بند.</div>'}
                </div>
                <div class="tool-row">
                    <input type="text" class="tool-input" data-tool-input="item" placeholder="بند جديد" maxlength="120">
                    <button type="button" class="tool-key tool-key-primary" data-tool-action="add" data-tool-field="item">إضافة</button>
                </div>`;
        }
    },
    notes: {
        label: 'ملاحظات',
        icon: 'fa-note-sticky',
        defaults: () => ({ title: 'ملاحظات' }),
        state: () => ({ text: '' }),
        actions: ['save'],
        render(config, state) {
            return `
                <textarea class="tool-textarea" data-tool-input="note" rows="4" maxlength="2000" placeholder="اكتب الملاحظة هنا...">${esc(state.text || '')}</textarea>
                <div class="tool-row tool-row-end">
                    <button type="button" class="tool-key tool-key-primary" data-tool-action="save" data-tool-field="note">حفظ</button>
                </div>`;
        }
    },
    dice: {
        label: 'نرد',
        icon: 'fa-dice',
        defaults: () => ({ sides: 6 }),
        state: config => ({ sides: clampNumber(config?.sides, 2, 100, 6), rolls: [], total: 0 }),
        actions: ['roll'],
        render(config, state) {
            const rolls = Array.isArray(state.rolls) ? state.rolls : [];
            return `
                <div class="tool-dice">
                    <div class="tool-dice-value">${rolls.length ? esc(rolls.join(' + ')) : '—'}</div>
                    <div class="tool-dice-total">${rolls.length ? `المجموع: ${esc(state.total ?? rolls.reduce((a, b) => a + b, 0))}` : `نرد بـ ${esc(state.sides || 6)} أوجه`}</div>
                </div>
                <div class="tool-row">
                    <button type="button" class="tool-key tool-key-primary" data-tool-action="roll" data-tool-value="1">رمية</button>
                    <button type="button" class="tool-key" data-tool-action="roll" data-tool-value="2">رميتان</button>
                    <button type="button" class="tool-key" data-tool-action="roll" data-tool-value="3">ثلاث</button>
                </div>`;
        }
    },
    picker: {
        label: 'قرعة',
        icon: 'fa-hand-sparkles',
        defaults: () => ({ title: 'قرعة', options: [] }),
        state: config => ({ options: (config?.options || []).slice(0, 12), chosen: null }),
        actions: ['add', 'remove', 'pick', 'reset'],
        render(config, state) {
            const options = Array.isArray(state.options) ? state.options : [];
            const chosen = Number.isInteger(state.chosen) && options[state.chosen] ? options[state.chosen] : null;
            return `
                <div class="tool-picker-chosen">${chosen ? `النتيجة: ${esc(chosen)}` : 'أضف الخيارات وخلّي القرعة تختار'}</div>
                <div class="tool-chips">
                    ${options.map((option, index) => `<span class="tool-chip">${esc(option)}<button type="button" data-tool-action="remove" data-tool-value="${index}" aria-label="حذف">×</button></span>`).join('')}
                </div>
                <div class="tool-row">
                    <input type="text" class="tool-input" data-tool-input="option" placeholder="خيار جديد" maxlength="60">
                    <button type="button" class="tool-key" data-tool-action="add" data-tool-field="option">إضافة</button>
                    <button type="button" class="tool-key tool-key-primary" data-tool-action="pick" ${options.length ? '' : 'disabled'}>اسحب</button>
                </div>`;
        }
    },
    converter: {
        label: 'محوّل وحدات',
        icon: 'fa-right-left',
        defaults: () => ({ category: 'length' }),
        state: config => {
            const category = config?.category === 'mass' || config?.category === 'temp' ? config.category : 'length';
            const units = category === 'temp' ? TEMP_UNITS : Object.keys(UNIT_TABLES[category]);
            return { category, from: units[0], to: units[1], value: '1' };
        },
        actions: ['set', 'swap'],
        render(config, state) {
            const category = state.category === 'mass' || state.category === 'temp' ? state.category : 'length';
            const units = category === 'temp' ? TEMP_UNITS : Object.keys(UNIT_TABLES[category]);
            const from = units.includes(state.from) ? state.from : units[0];
            const to = units.includes(state.to) ? state.to : units[1];
            const converted = convertValue(category, from, to, state.value);
            return `
                <div class="tool-convert-row">
                    <input type="number" class="tool-input" data-tool-input="value" value="${esc(state.value ?? '1')}" step="any">
                    <select class="tool-select" data-tool-input="from">${units.map(unit => `<option value="${esc(unit)}" ${unit === from ? 'selected' : ''}>${esc(unit)}</option>`).join('')}</select>
                    <button type="button" class="tool-key" data-tool-action="swap">⇄</button>
                    <select class="tool-select" data-tool-input="to">${units.map(unit => `<option value="${esc(unit)}" ${unit === to ? 'selected' : ''}>${esc(unit)}</option>`).join('')}</select>
                </div>
                <div class="tool-row tool-row-end">
                    <span class="tool-convert-result">${converted === null ? '—' : `${Math.round(converted * 1e6) / 1e6} ${esc(to)}`}</span>
                    <button type="button" class="tool-key tool-key-primary" data-tool-action="set">تحويل</button>
                </div>`;
        }
    },
    tictactoe: {
        label: 'إكس-أو',
        icon: 'fa-hashtag',
        defaults: () => ({}),
        state: () => ({ board: Array(9).fill(null), turn: 'X', winner: null }),
        actions: ['play', 'reset'],
        render(config, state, ctx) {
            const board = Array.isArray(state.board) && state.board.length === 9 ? state.board : Array(9).fill(null);
            const winner = state.winner;
            return `
                <div class="tool-board">
                    ${board.map((mark, index) => `<button type="button" class="tool-board-cell ${mark ? 'is-filled' : ''}" data-tool-action="play" data-tool-value="${index}">${esc(mark || '')}</button>`).join('')}
                </div>
                <div class="tool-row tool-row-end">
                    <span class="tool-status">${winner ? (winner === 'draw' ? 'تعادل' : `فاز ${winner}`) : `دور ${state.turn === 'O' ? 'O' : 'X'}`}</span>
                    <button type="button" class="tool-key" data-tool-action="reset">لعبة جديدة</button>
                </div>`;
        }
    },
    custom: {
        label: 'أداة مخصصة',
        icon: 'fa-wand-magic-sparkles',
        defaults: () => ({ controls: [], options: [] }),
        state: config => {
            const values = {};
            (config?.controls || []).forEach(control => {
                if (control.key) values[control.key] = defaultControlValue(control);
            });
            return { ...values, ...(config?.initial && typeof config.initial === 'object' ? config.initial : {}) };
        },
        actions: ['custom'],
        render(config, state, ctx) {
            const controls = Array.isArray(config?.controls) ? config.controls : [];
            if (!controls.length) return '<div class="tool-empty">الأداة بلا مكوّنات.</div>';
            const parts = [];
            let buttonRow = [];
            const flush = () => {
                if (buttonRow.length) {
                    parts.push(`<div class="tool-row">${buttonRow.join('')}</div>`);
                    buttonRow = [];
                }
            };
            controls.forEach((control, index) => {
                const value = state?.[control.key];
                if (control.type === 'button') {
                    buttonRow.push(`<button type="button" class="tool-key ${control.op?.type === 'reset' ? 'tool-key-warn' : 'tool-key-primary'}" data-tool-action="custom" data-tool-value="${index}">${esc(control.label || 'زر')}</button>`);
                    return;
                }
                flush();
                if (control.type === 'display') {
                    parts.push(`<div class="tool-custom-display"><span>${esc(control.label)}</span><strong>${esc(formatValue(value))}${control.suffix ? esc(control.suffix) : ''}</strong></div>`);
                } else if (control.type === 'progress') {
                    const max = clampNumber(control.max, 1, 1e6, 100);
                    const percent = Math.min(100, Math.max(0, Math.round((Number(value) || 0) / max * 100)));
                    parts.push(`<div class="tool-custom-progress"><span class="bar" style="width:${percent}%"></span><span class="text">${esc(control.label)} · ${percent}%</span></div>`);
                } else if (control.type === 'list') {
                    const items = Array.isArray(value) ? value : [];
                    parts.push(`<div class="tool-list">${items.length
                        ? items.map((item, itemIndex) => `<div class="tool-list-item"><span class="tool-list-text">${esc(item)}</span><button type="button" class="tool-list-remove" data-tool-action="custom" data-tool-value="${index}" data-tool-mode="list-remove" data-tool-item="${itemIndex}" aria-label="حذف">×</button></div>`).join('')
                        : '<div class="tool-empty">لا عناصر بعد.</div>'}</div>`);
                    parts.push(`<div class="tool-row"><input type="text" class="tool-input" data-tool-input="custom.${esc(control.key)}" placeholder="${esc(control.placeholder || 'عنصر جديد')}" maxlength="120"><button type="button" class="tool-key tool-key-primary" data-tool-action="custom" data-tool-value="${index}" data-tool-field="custom.${esc(control.key)}" data-tool-mode="push">إضافة</button></div>`);
                } else if (control.type === 'input') {
                    parts.push(`<div class="tool-row"><input type="text" class="tool-input" data-tool-input="custom.${esc(control.key)}" value="${esc(value ?? '')}" placeholder="${esc(control.placeholder || control.label)}" maxlength="300"><button type="button" class="tool-key tool-key-primary" data-tool-action="custom" data-tool-value="${index}" data-tool-field="custom.${esc(control.key)}">حفظ</button></div>`);
                } else if (control.type === 'note') {
                    parts.push(`<textarea class="tool-textarea" rows="3" data-tool-input="custom.${esc(control.key)}" maxlength="1000" placeholder="${esc(control.placeholder || control.label)}">${esc(value ?? '')}</textarea>`);
                    parts.push(`<div class="tool-row tool-row-end"><button type="button" class="tool-key tool-key-primary" data-tool-action="custom" data-tool-value="${index}" data-tool-field="custom.${esc(control.key)}">حفظ</button></div>`);
                } else if (control.type === 'slider') {
                    const min = clampNumber(control.min, -1e6, 1e6, 0);
                    const max = clampNumber(control.max, min + 1, 1e6, 10);
                    parts.push(`<div class="tool-custom-slider"><span>${esc(control.label)} <b>${esc(formatValue(value))}</b></span><input type="range" min="${min}" max="${max}" step="${clampNumber(control.step, 0.01, 1000, 1)}" value="${clampNumber(value, min, max, min)}" data-tool-input="custom.${esc(control.key)}"><button type="button" class="tool-key tool-key-primary" data-tool-action="custom" data-tool-value="${index}" data-tool-field="custom.${esc(control.key)}">تعيين</button></div>`);
                } else if (control.type === 'toggle') {
                    buttonRow.push(`<button type="button" class="tool-key ${value ? 'tool-key-primary' : ''}" data-tool-action="custom" data-tool-value="${index}" aria-pressed="${value ? 'true' : 'false'}">${esc(control.label)}: ${value ? 'مفعّل' : 'مطفأ'}</button>`);
                } else if (control.type === 'timer') {
                    const endsAt = Number(state?.[`${control.key}__ends`]) || 0;
                    const seconds = endsAt ? Math.max(0, Math.round((endsAt - Date.now()) / 1000)) : clampNumber(value, 5, 7200, 60);
                    const clock = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
                    parts.push(`<div class="tool-timer" data-tool-timer data-ends="${endsAt || ''}"><div class="tool-timer-display">${clock}</div><div class="tool-row"><button type="button" class="tool-key tool-key-primary" data-tool-action="custom" data-tool-value="${index}" data-tool-mode="timer-start">تشغيل</button><button type="button" class="tool-key" data-tool-action="custom" data-tool-value="${index}" data-tool-mode="timer-reset">إعادة</button></div></div>`);
                }
            });
            flush();
            return `${config?.intro ? `<div class="tool-custom-intro">${esc(config.intro)}</div>` : ''}${parts.join('')}`;
        }
    }
};

export const TOOL_KIND_LIST = Object.keys(TOOL_KINDS);

/* ---------- normalization + prompt ---------- */

export function normalizeToolSpec(spec) {
    if (!spec || typeof spec !== 'object') return null;
    const kind = TOOL_KIND_LIST.includes(spec.kind) ? spec.kind : null;
    if (!kind) return null;
    const definition = TOOL_KINDS[kind];
    const rawConfig = spec.config && typeof spec.config === 'object' ? spec.config : {};
    const config = { ...definition.defaults() };
    if (typeof rawConfig.title === 'string') config.title = cleanText(rawConfig.title, 60);
    if (typeof rawConfig.label === 'string') config.label = cleanText(rawConfig.label, 40);
    if (typeof rawConfig.question === 'string') config.question = cleanText(rawConfig.question, 120);
    if (rawConfig.seconds !== undefined) config.seconds = clampNumber(rawConfig.seconds, 5, 7200, 60);
    if (rawConfig.step !== undefined) config.step = clampNumber(rawConfig.step, 1, 1000, 1);
    if (rawConfig.sides !== undefined) config.sides = clampNumber(rawConfig.sides, 2, 100, 6);
    if (rawConfig.category === 'mass' || rawConfig.category === 'temp' || rawConfig.category === 'length') config.category = rawConfig.category;
    if (Array.isArray(rawConfig.options)) {
        config.options = rawConfig.options.map(option => cleanText(option, 60)).filter(Boolean).slice(0, 10);
    }
    if (Array.isArray(rawConfig.items)) {
        config.items = rawConfig.items.map(item => cleanText(item, 120)).filter(Boolean).slice(0, 20);
    }
    if (kind === 'custom') {
        const controls = [];
        const rawControls = Array.isArray(rawConfig.controls) ? rawConfig.controls.slice(0, 12) : [];
        rawControls.forEach((raw, position) => {
            if (!raw || typeof raw !== 'object') return;
            const type = CUSTOM_CONTROL_TYPES.includes(raw.type) ? raw.type : null;
            if (!type) return;
            const key = cleanText(raw.key, 24).replace(/[^A-Za-z0-9_]/g, '') || `field${position}`;
            const control = { type, key, label: cleanText(raw.label, 40) || key };
            if (type === 'button') {
                const rawOp = raw.op && typeof raw.op === 'object' ? raw.op : {};
                const opType = CUSTOM_OP_TYPES.includes(rawOp.type) ? rawOp.type : 'set';
                control.op = { type: opType };
                if (rawOp.key) control.op.key = cleanText(rawOp.key, 24).replace(/[^A-Za-z0-9_]/g, '');
                if (rawOp.from) control.op.from = cleanText(rawOp.from, 24).replace(/[^A-Za-z0-9_]/g, '');
                if (typeof rawOp.value === 'number') control.op.value = clampNumber(rawOp.value, -1e6, 1e6, 0);
                else if (typeof rawOp.value === 'boolean') control.op.value = rawOp.value;
                else if (typeof rawOp.value === 'string') control.op.value = rawOp.value.slice(0, 200);
            }
            if (type === 'slider') {
                control.min = clampNumber(raw.min, -1e6, 1e6, 0);
                control.max = clampNumber(raw.max, control.min + 1, 1e6, control.min + 10);
                control.step = clampNumber(raw.step, 0.01, 1000, 1);
            }
            if (type === 'progress') control.max = clampNumber(raw.max, 1, 1e6, 100);
            if (type === 'timer') control.seconds = clampNumber(raw.seconds, 5, 7200, 60);
            if (type === 'input' || type === 'note') control.placeholder = cleanText(raw.placeholder, 60);
            if (typeof raw.suffix === 'string') control.suffix = cleanText(raw.suffix, 12);
            controls.push(control);
        });
        if (!controls.length) return null;
        config.controls = controls;
        if (rawConfig.initial && typeof rawConfig.initial === 'object') {
            const initial = {};
            Object.entries(rawConfig.initial).slice(0, 20).forEach(([key, value]) => {
                const cleanKey = cleanText(key, 24).replace(/[^A-Za-z0-9_]/g, '');
                if (!cleanKey || (typeof value === 'object' && value !== null)) return;
                if (!controls.some(control => control.key === cleanKey)) return;
                initial[cleanKey] = typeof value === 'boolean' ? value : Number.isFinite(Number(value)) && value !== '' ? Number(value) : String(value).slice(0, 300);
            });
            config.initial = initial;
        }
    }
    const title = cleanText(spec.title || config.title || config.label || definition.label, 60) || definition.label;
    return { kind, title, config };
}

export function isToolRequest(text) {
    const value = String(text || '');
    if (!value) return false;
    const toolWords = /(أداة|اداة|آلة|الة|widget|أداة تفاعلية|أدوات)/iu;
    const buildWords = /(سوي|سوّي|اعمل|إعمل|اعملي|اصنع|صمم|صمّمي|انشئ|أنشئ|ضيف|أضف|اريد|أريد|محتاج|ابغى|أبغى|خلّي|خلي|قدم|قدّم|ركب|سوولي|سويلي|اعمليلي|ابني)/iu;
    const kinds = /(حاسبة|حاسبه|آلة حاسبة|عدّاد|عداد|مؤقت|مؤقّت|تايمر|تصويت|استفتاء|قائمة|تشيك ليست|مهام|ملاحظات|نوت|نرد|زهر|قرعة|محوّل|محول|تحويل وحدات|إكس|اكس او|تيك تاك تو|x-o|لعبة)/iu;
    if (toolWords.test(value) && (buildWords.test(value) || kinds.test(value))) return true;
    return buildWords.test(value) && kinds.test(value);
}

export function isImageRequest(text) {
    const value = String(text || '');
    if (!value) return false;
    const imageWords = /(صورة|صوره|صور|رسمة|رسمه|شعار|لوجو|خلفية|خلفيه|بوستر|ملصق|ستيكر|ايموجي|image|photo|picture|png|jpg|jpeg|webp)/iu;
    if (!imageWords.test(value)) return false;
    if (isToolRequest(value)) return false;
    const intent = /(ارسل|أرسل|ابعث|ابعت|هات|جيب|جيبلي|وريني|ورّيني|دور|دوّر|ابحث|لقي|لاقي|احتاج|محتاج|اريد|أريد|ابغى|أبغى|search|find|send|show|need|want)/iu;
    return intent.test(value) || value.trim().length <= 40;
}

export function buildImageQueryPrompt(userMessage, userName) {
    return `المستخدم ${userName} طلب صورة: "${userMessage}"
اكتب من 1 إلى 3 عبارات بحث قصيرة (كلمتين إلى أربع كلمات) للعثور على الصورة المناسبة في مكتبة Wikimedia Commons.
- فضّل الإنجليزية للدقة، وأضف عبارة عربية واحدة إذا كانت مناسبة للموضوع.
- لا تكتب روابط، فقط عبارات بحث.
أجب بـ JSON فقط بهذا الشكل وبلا أي نص إضافي:
{"queries":["short english query","عبارة عربية"],"caption":"جملة قصيرة باللهجة العراقية تصف الصورة"}`;
}

export function buildToolPrompt(userMessage, userName, moodLabel) {
    const catalogue = TOOL_KIND_LIST.map(kind => `${kind} (${TOOL_KINDS[kind].label})`).join(', ');
    return `المستخدم ${userName} طلب أداة تفاعلية داخل الدردشة: "${userMessage}"
مزاجك الحالي ${moodLabel}.

اختر أنسب أداة من هذه الأنواع: ${catalogue}.
- حاسبة: config {} — آلة حاسبة بضغطة أزرار.
- عدّاد: config {label, step} — عدّاد بزيادة ونقصان.
- مؤقت: config {seconds} — مؤقّت تنازلي بالثواني.
- تصويت: config {question, options:[..]} — استفتاء بخيارات يصوّت عليها الأعضاء.
- قائمة مهام: config {title, items:[..]} — قائمة بنود تُعلَّم كمُنجزة.
- ملاحظات: config {title} — لوح ملاحظات مشترك.
- نرد: config {sides} — رمي نرد.
- قرعة: config {title, options:[..]} — سحب عشوائي بين خيارات.
- محوّل وحدات: config {category} حيث category إما length أو mass أو temp.
- إكس-أو: config {} — لعبة إكس-أو بلوح مشترك.

وإذا كان الطلب أي شيء آخر غير ما فوق، استخدم النوع custom وابنِ الأداة من المكوّنات التالية داخل config.controls (حتى 12 مكوّناً):
- {"type":"display","key":"score","label":"النقاط","suffix":" نقطة"} — عرض قيمة.
- {"type":"progress","key":"score","label":"التقدم","max":100} — شريط تقدم.
- {"type":"button","label":"+1","op":{"type":"add","key":"score","value":1}} — زر ينفّذ عملية.
  أنواع العمليات: add, sub, set, toggle, clear, pop, push, random, reset.
- {"type":"slider","key":"level","label":"المستوى","min":1,"max":10,"step":1} — شريحة قيمة.
- {"type":"toggle","key":"on","label":"التشغيل"} — زر تبديل.
- {"type":"input","key":"name","label":"الاسم"} — حقل نصي.
- {"type":"note","key":"note","label":"ملاحظة"} — مساحة نص طويل.
- {"type":"list","key":"items","label":"بنود"} — قائمة عناصر.
- {"type":"timer","key":"t","seconds":60} — مؤقّت.
ويمكن أن تحمل config حقولاً إضافية: "intro" وصف قصير، و"options" قائمة خيارات، و"initial" قيم ابتدائية مثل {"score":0}.
كل مكوّن يجب أن يملك key بالإنجليزية بدون مسافات.

أجب بـ JSON فقط بهذا الشكل وبلا أي نص إضافي:
{"kind":"نوع الأداة","title":"عنوان قصير بالعربية","caption":"جملة قصيرة تخبرهم أن الأداة جاهزة","config":{...}}`;
}

export function parseToolResponse(rawText) {
    const text = String(rawText || '').trim();
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return null;
    let parsed;
    try {
        parsed = JSON.parse(text.slice(start, end + 1));
    } catch {
        return null;
    }
    const tool = normalizeToolSpec(parsed);
    if (!tool) return null;
    const caption = cleanText(parsed.caption, 160) || `جهّزت لك ${tool.title}، جرّبوها سوا.`;
    return { tool, caption };
}

/* ---------- state transitions ---------- */

export function applyToolAction(kind, config, currentState, action, payload, ctx) {
    const definition = TOOL_KINDS[kind];
    if (!definition || !definition.actions.includes(action)) return null;
    const state = { ...(currentState || {}) };
    const user = ctx?.user || 'guest';
    const name = ctx?.name || 'ضيف';

    if (kind === 'calculator') {
        if (action === 'press') {
            const value = String(payload?.value || '').slice(0, 4);
            if (value === '=') {
                const outcome = evaluateExpression(state.expr);
                state.result = outcome.ok ? outcome.value : '';
                state.error = outcome.ok ? '' : outcome.error;
                if (outcome.ok) state.expr = outcome.value;
                return state;
            }
            const next = `${state.expr || ''}${value}`.slice(0, 60);
            state.expr = next;
            state.error = '';
            state.result = '';
            return state;
        }
        if (action === 'clear') return { expr: '', result: '', error: '' };
        if (action === 'back') {
            state.expr = String(state.expr || '').slice(0, -1);
            state.error = '';
            return state;
        }
    }

    if (kind === 'counter') {
        const step = clampNumber(state.step, 1, 1000, 1);
        if (action === 'inc') state.value = clampNumber(state.value, -1e9, 1e9, 0) + step;
        if (action === 'dec') state.value = clampNumber(state.value, -1e9, 1e9, 0) - step;
        if (action === 'reset') state.value = 0;
        return state;
    }

    if (kind === 'timer') {
        if (action === 'start') {
            const remaining = clampNumber(state.remaining, 1, 7200, 60);
            state.remaining = remaining;
            state.endsAt = Date.now() + remaining * 1000;
            state.running = true;
        }
        if (action === 'pause') {
            state.remaining = state.endsAt ? Math.max(0, Math.round((state.endsAt - Date.now()) / 1000)) : clampNumber(state.remaining, 0, 7200, 60);
            state.endsAt = null;
            state.running = false;
        }
        if (action === 'reset') {
            state.remaining = clampNumber(config?.seconds, 5, 7200, 60);
            state.endsAt = null;
            state.running = false;
        }
        if (action === 'add') {
            const extra = clampNumber(payload?.value, 5, 3600, 60);
            if (state.running && state.endsAt) state.endsAt += extra * 1000;
            else state.remaining = clampNumber(state.remaining, 0, 7200, 60) + extra;
        }
        return state;
    }

    if (kind === 'poll') {
        if (action === 'vote') {
            const options = config?.options || [];
            const index = Number(payload?.value);
            if (!Number.isInteger(index) || index < 0 || index >= options.length) return null;
            const votes = Array.isArray(state.votes) ? state.votes.slice() : options.map(() => 0);
            const voters = { ...(state.voters || {}) };
            const previous = voters[user];
            if (previous === index) return null;
            if (Number.isInteger(previous) && votes[previous] > 0) votes[previous] -= 1;
            votes[index] = (Number(votes[index]) || 0) + 1;
            voters[user] = index;
            return { votes, voters };
        }
    }

    if (kind === 'checklist') {
        const items = Array.isArray(state.items) ? state.items.map(item => ({ ...item })) : [];
        if (action === 'toggle') {
            const index = Number(payload?.value);
            if (items[index]) items[index].done = !items[index].done;
            return { items };
        }
        if (action === 'add') {
            const text = cleanText(payload?.text, 120);
            if (!text || items.length >= 30) return null;
            items.push({ text, done: false });
            return { items };
        }
        if (action === 'remove') {
            const index = Number(payload?.value);
            if (index >= 0 && index < items.length) items.splice(index, 1);
            return { items };
        }
    }

    if (kind === 'notes') {
        if (action === 'save') {
            const text = String(payload?.text ?? '').slice(0, 2000);
            if (text === (state.text || '')) return null;
            return { text, updatedBy: name };
        }
    }

    if (kind === 'dice') {
        if (action === 'roll') {
            const sides = clampNumber(state.sides, 2, 100, 6);
            const count = clampNumber(payload?.value, 1, 5, 1);
            const rolls = Array.from({ length: count }, () => 1 + Math.floor(Math.random() * sides));
            return { sides, rolls, total: rolls.reduce((sum, value) => sum + value, 0) };
        }
    }

    if (kind === 'picker') {
        const options = Array.isArray(state.options) ? state.options.slice() : [];
        if (action === 'add') {
            const text = cleanText(payload?.text, 60);
            if (!text || options.length >= 12) return null;
            options.push(text);
            return { options, chosen: null };
        }
        if (action === 'remove') {
            const index = Number(payload?.value);
            if (index >= 0 && index < options.length) options.splice(index, 1);
            return { options, chosen: null };
        }
        if (action === 'pick') {
            if (!options.length) return null;
            return { options, chosen: Math.floor(Math.random() * options.length) };
        }
        if (action === 'reset') return { options, chosen: null };
    }

    if (kind === 'converter') {
        const category = state.category === 'mass' || state.category === 'temp' ? state.category : 'length';
        const units = category === 'temp' ? TEMP_UNITS : Object.keys(UNIT_TABLES[category]);
        if (action === 'set') {
            const fields = payload?.fields || {};
            const value = String(fields.value ?? state.value ?? '1').slice(0, 20);
            const from = units.includes(fields.from) ? fields.from : state.from;
            const to = units.includes(fields.to) ? fields.to : state.to;
            return { category, value, from, to };
        }
        if (action === 'swap') return { category, value: state.value, from: state.to, to: state.from };
    }

    if (kind === 'tictactoe') {
        const board = Array.isArray(state.board) && state.board.length === 9 ? state.board.slice() : Array(9).fill(null);
        if (action === 'reset') return { board: Array(9).fill(null), turn: 'X', winner: null };
        if (action === 'play') {
            const index = Number(payload?.value);
            if (state.winner) return null;
            if (!Number.isInteger(index) || index < 0 || index > 8 || board[index]) return null;
            board[index] = state.turn === 'O' ? 'O' : 'X';
            const nextTurn = board[index] === 'X' ? 'O' : 'X';
            let winner = null;
            if (winLine(board, board[index])) winner = board[index];
            else if (board.every(cell => cell)) winner = 'draw';
            return { board, turn: nextTurn, winner, lastBy: name };
        }
    }

    if (kind === 'custom') {
        if (action !== 'custom') return null;
        const controls = Array.isArray(config?.controls) ? config.controls : [];
        const index = Number(payload?.value);
        const control = controls[index];
        if (!control || !control.key) return null;
        const mode = payload?.mode || '';
        const next = { ...state };
        const field = payload?.fields?.[`custom.${control.key}`];

        if (mode === 'list-remove') {
            const items = Array.isArray(state[control.key]) ? state[control.key].slice() : [];
            const itemIndex = Number(payload?.item);
            if (itemIndex < 0 || itemIndex >= items.length) return null;
            items.splice(itemIndex, 1);
            next[control.key] = items;
            next.updatedBy = name;
            return next;
        }

        if (mode === 'timer-start') {
            const seconds = clampNumber(state[control.key], 5, 7200, 60);
            next[control.key] = seconds;
            next[`${control.key}__ends`] = Date.now() + seconds * 1000;
            next.updatedBy = name;
            return next;
        }

        if (mode === 'timer-reset') {
            next[control.key] = clampNumber(control.seconds, 5, 7200, 60);
            next[`${control.key}__ends`] = 0;
            next.updatedBy = name;
            return next;
        }

        if (control.type === 'slider') {
            const min = clampNumber(control.min, -1e6, 1e6, 0);
            const max = clampNumber(control.max, min + 1, 1e6, 10);
            const updated = clampNumber(field, min, max, min);
            if (updated === state[control.key]) return null;
            next[control.key] = updated;
            next.updatedBy = name;
            return next;
        }

        if (control.type === 'input' || control.type === 'note') {
            const updated = String(field ?? '').slice(0, 1000);
            if (updated === (state[control.key] || '')) return null;
            next[control.key] = updated;
            next.updatedBy = name;
            return next;
        }

        if (control.type === 'toggle') {
            next[control.key] = !state[control.key];
            next.updatedBy = name;
            return next;
        }

        if (control.type === 'list') {
            const text = cleanText(field, 120);
            const items = Array.isArray(state[control.key]) ? state[control.key].slice() : [];
            if (mode === 'push' || !mode) {
                if (!text || items.length >= 50) return null;
                items.push(text);
                next[control.key] = items;
                next.updatedBy = name;
                return next;
            }
            return null;
        }

        if (control.type === 'button') {
            const op = control.op && typeof control.op === 'object' ? control.op : { type: 'set' };
            const key = op.key || control.key;
            switch (op.type) {
                case 'add':
                    next[key] = clampNumber(state[key], -1e9, 1e9, 0) + clampNumber(op.value, -1e6, 1e6, 1);
                    break;
                case 'sub':
                    next[key] = clampNumber(state[key], -1e9, 1e9, 0) - clampNumber(op.value, -1e6, 1e6, 1);
                    break;
                case 'set':
                    if (typeof op.value === 'boolean') next[key] = op.value;
                    else if (Number.isFinite(Number(op.value)) && op.value !== '') next[key] = Number(op.value);
                    else next[key] = String(op.value ?? '').slice(0, 300);
                    break;
                case 'toggle':
                    next[key] = !state[key];
                    break;
                case 'clear':
                    next[key] = Array.isArray(state[key]) ? [] : typeof state[key] === 'boolean' ? false : '';
                    break;
                case 'pop':
                    next[key] = Array.isArray(state[key]) ? state[key].slice(0, -1) : [];
                    break;
                case 'push': {
                    const text = cleanText(payload?.text ?? field, 200);
                    if (!text) return null;
                    next[key] = [...(Array.isArray(state[key]) ? state[key] : []), text].slice(0, 50);
                    break;
                }
                case 'random': {
                    const pool = Array.isArray(state[op.from]) ? state[op.from] : (Array.isArray(config?.options) ? config.options : []);
                    if (!pool.length) return null;
                    next[key] = String(pool[Math.floor(Math.random() * pool.length)]);
                    break;
                }
                case 'reset': {
                    const fresh = TOOL_KINDS.custom.state(config);
                    fresh.updatedBy = name;
                    return fresh;
                }
                default:
                    return null;
            }
            next.updatedBy = name;
            return next;
        }

        return null;
    }

    return null;
}

/* ---------- rendering ---------- */

export function renderToolCard(msgKey, tool, state, ctx) {
    const definition = TOOL_KINDS[tool?.kind];
    if (!definition) return '';
    const currentState = state && typeof state === 'object' ? state : definition.state(tool.config || {});
    const updatedBy = currentState.updatedBy || currentState.lastBy;
    return `
        <div class="tool-card" data-tool-card data-tool-msg="${esc(msgKey)}">
            <div class="tool-card-head">
                <span class="tool-card-icon"><i class="fas ${definition.icon}"></i></span>
                <span class="tool-card-title">${esc(tool.title || definition.label)}</span>
                <span class="tool-card-kind">${esc(definition.label)}</span>
                <button type="button" class="tool-card-menu" data-tool-menu aria-label="خيارات الرسالة"><i class="fas fa-ellipsis"></i></button>
            </div>
            <div class="tool-card-body">${definition.render(tool.config || {}, currentState, ctx || {})}</div>
            ${updatedBy ? `<div class="tool-card-foot">آخر تحديث من ${esc(updatedBy)}</div>` : ''}
        </div>`;
}

const activeTimers = [];

export function clearToolTimers() {
    while (activeTimers.length) clearInterval(activeTimers.pop());
}

export function mountToolTimers(root) {
    clearToolTimers();
    if (!root) return;
    root.querySelectorAll('[data-tool-timer]').forEach(element => {
        const endsAt = Number(element.dataset.ends);
        const display = element.querySelector('.tool-timer-display');
        if (!display) return;
        if (!endsAt) {
            display.classList.remove('is-running');
            return;
        }
        display.classList.add('is-running');
        const render = () => {
            const remaining = Math.max(0, Math.round((endsAt - Date.now()) / 1000));
            display.textContent = `${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}`;
            if (remaining <= 0) {
                clearInterval(timer);
                display.classList.remove('is-running');
                display.textContent = '00:00';
            }
        };
        const timer = setInterval(render, 500);
        activeTimers.push(timer);
        render();
    });
}
