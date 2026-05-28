/**
 * script.js - Gestão Financeira Pessoal
 * Predictive Cash Flow Logic & UI Controller
 */

import { GristTableLens } from './libraries/grist-table-lens/grist-table-lens.js';

// --- Global State ---
let state = {
    contas: [],
    cartoes: [],
    categorias: [],
    transacoes: [],
    parcelamentos: [],
    boletos: [],
    recorrencias: [],
    recorrenciasRegras: [],
    currentMonth: new Date().getMonth() + 1,
    currentYear: new Date().getFullYear(),
    predictionDetails: [] 
};

let selectedItemId = null;
const tableLens = new GristTableLens(grist);

// --- Grist Initialization ---
grist.ready({ requiredAccess: 'full' });
grist.onRecords(async () => { await fetchData(); });

// --- Tab Navigation ---
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(btn.getAttribute('data-tab')).classList.add('active');
    });
});

/**
 * Fetch all necessary tables from Grist using TableLens
 */
async function fetchData() {
    updateStatus('Sincronizando...');
    try {
        const [contas, cartoes, categorias, transacoes, parcelamentos, boletos, recorrencias, recorrenciasRegras] = await Promise.all([
            tableLens.fetchTableRecords('Contas'),
            tableLens.fetchTableRecords('Cartoes'),
            tableLens.fetchTableRecords('Categorias'),
            tableLens.fetchTableRecords('Transacoes'),
            tableLens.fetchTableRecords('Parcelamentos'),
            tableLens.fetchTableRecords('Boletos'),
            tableLens.fetchTableRecords('Recorrencias'),
            tableLens.fetchTableRecords('RecorrenciasRegras')
        ]);
        
        state.contas = contas;
        state.cartoes = cartoes;
        state.categorias = categorias;
        state.transacoes = transacoes;
        state.parcelamentos = parcelamentos;
        state.boletos = boletos;
        state.recorrencias = recorrencias;
        state.recorrenciasRegras = recorrenciasRegras;

        updateStatus('Sincronizado.');
        calculateAndRender();
    } catch (err) {
        console.error('Erro ao buscar dados:', err);
        updateStatus(`Erro: ${err.message}`);
    }
}

function updateStatus(msg) {
    const el = document.getElementById('status-bar');
    if (el) el.textContent = msg;
}

function formatCurrency(val) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val || 0);
}

/**
 * Main logic for rendering all tabs
 */
function calculateAndRender() {
    const totalBalance = state.contas.reduce((acc, c) => acc + (c.SaldoAtual || 0), 0);
    const balanceEl = document.getElementById('total-balance');
    if (balanceEl) balanceEl.textContent = formatCurrency(totalBalance);
    
    renderPrediction(totalBalance);
    renderTransactions();
    renderRecurring();
    renderCardsAndInstallments();
    renderSettings();

    if (selectedItemId && document.getElementById('recurring-modal').style.display === 'block') {
        renderRules(selectedItemId);
    }
}

// --- RENDERERS ---

function renderPrediction(startingBalance) {
    const listEl = document.getElementById('prediction-list');
    if (!listEl) return;
    listEl.innerHTML = '';
    
    state.predictionDetails = [];
    let runningBalance = startingBalance;
    const monthsNames = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    const timeline = [];
    
    for (let i = 0; i < 6; i++) {
        const targetDate = new Date(state.currentYear, state.currentMonth - 1 + i, 1);
        const m = targetDate.getMonth() + 1;
        const y = targetDate.getFullYear();
        const monthIdx = targetDate.getMonth();
        const monthEvents = [];

        state.recorrencias.filter(r => r.Ativo).forEach(recorrencia => {
            const activeRule = state.recorrenciasRegras
                .filter(regra => regra.RecorrenciaId === recorrencia.id)
                .filter(regra => (regra.AnoInicio < y) || (regra.AnoInicio === y && regra.MesInicio <= m))
                .sort((a, b) => (a.AnoInicio !== b.AnoInicio ? b.AnoInicio - a.AnoInicio : b.MesInicio - a.MesInicio))[0];

            if (activeRule) {
                const event = { descricao: recorrencia.Nome, valor: recorrencia.Tipo === 'Entrada' ? activeRule.Valor : -activeRule.Valor, dia: activeRule.DiaVencimento, cartaoId: activeRule.CartaoId };
                if (event.cartaoId) {
                    const card = state.cartoes.find(c => c.id === event.cartaoId);
                    if (card) {
                        let iM = m; let iY = y;
                        if (event.dia > card.DiaFechamento) iM++;
                        iM++; if (iM > 12) { iM -= 12; iY++; }
                        timeline.push({ ...event, dia: card.DiaVencimento, targetMonth: iM, targetYear: iY, shifted: true });
                    }
                } else { monthEvents.push(event); }
            }
        });

        state.boletos.filter(b => !b.Pago).forEach(b => {
            const bDate = new Date(b.DataVencimento);
            if (bDate.getMonth() + 1 === m && bDate.getFullYear() === y) monthEvents.push({ descricao: b.Descricao, valor: -b.Valor, dia: bDate.getDate() });
        });

        state.parcelamentos.forEach(parc => {
            const card = state.cartoes.find(c => c.id === parc.CartaoId);
            if (!card) return;
            const pDate = new Date(parc.DataCompra);
            const mDiff = (y - pDate.getFullYear()) * 12 + (m - (pDate.getMonth() + 1));
            if (mDiff >= 0 && mDiff < parc.NumeroParcelas) {
                let iM = m; let iY = y;
                if (pDate.getDate() > card.DiaFechamento) iM++;
                iM++; if (iM > 12) { iM -= 12; iY++; }
                timeline.push({ descricao: `${parc.Descricao} (${mDiff + 1}/${parc.NumeroParcelas})`, valor: -(parc.ValorTotal / parc.NumeroParcelas), dia: card.DiaVencimento, targetMonth: iM, targetYear: iY, shifted: true });
            }
        });

        const incoming = timeline.filter(e => e.targetMonth === m && e.targetYear === y && e.shifted);
        const finalEvents = [...monthEvents, ...incoming].sort((a, b) => a.dia - b.dia);
        const impact = finalEvents.reduce((acc, e) => acc + (e.valor || 0), 0);
        runningBalance += impact;

        state.predictionDetails.push({ monthName: `${monthsNames[monthIdx]} ${y}`, events: finalEvents, totalIn: finalEvents.filter(e => e.valor > 0).reduce((acc, e) => acc + e.valor, 0), totalOut: finalEvents.filter(e => e.valor < 0).reduce((acc, e) => acc + Math.abs(e.valor), 0), balance: runningBalance });

        const row = document.createElement('div');
        row.className = 'month-row clickable-row';
        row.onclick = () => openMonthModal(i);
        row.innerHTML = `<span>${monthsNames[monthIdx]} ${y}</span><span class="month-balance ${runningBalance >= 0 ? 'positive' : 'negative'}">${formatCurrency(runningBalance)}</span>`;
        listEl.appendChild(row);
    }
}

function renderTransactions() {
    const listEl = document.getElementById('transaction-list');
    if (!listEl) return;
    const sorted = [...state.transacoes].sort((a, b) => new Date(b.Data) - new Date(a.Data)).slice(0, 50);
    listEl.innerHTML = sorted.map(t => {
        const cat = state.categorias.find(c => c.id === t.CategoriaId);
        const conta = state.contas.find(c => c.id === t.ContaId);
        return `<div class="month-row clickable-row" onclick="openTransactionModal(${t.id})"><div style="display:flex;flex-direction:column;"><span style="font-weight:bold;">${t.Descricao}</span><small>${new Date(t.Data).toLocaleDateString('pt-BR')} | ${cat ? cat.Nome : '-'} | ${conta ? conta.Nome : '-'}</small></div><span class="${t.Tipo === 'Entrada' ? 'positive' : 'negative'}">${formatCurrency(t.Valor)}</span></div>`
    }).join('') || '<p>Nenhuma transação encontrada.</p>';
}

function renderRecurring() {
    const listEl = document.getElementById('recurring-list');
    if (!listEl) return;
    const catFilter = document.getElementById('filter-recurring-category');
    if (catFilter && catFilter.options.length <= 1) catFilter.innerHTML = '<option value="">Categoria (Todas)</option>' + state.categorias.map(c => `<option value="${c.id}">${c.Nome}</option>`).join('');
    const tF = document.getElementById('filter-recurring-type').value;
    const cF = document.getElementById('filter-recurring-category').value;
    const filtered = state.recorrencias.filter(r => (!tF || r.Tipo === tF) && (!cF || Number(r.CategoriaId) === Number(cF)));
    listEl.innerHTML = filtered.map(r => {
        const cat = state.categorias.find(c => c.id === r.CategoriaId);
        return `<div class="month-row clickable-row" onclick="openRecurringModal(${r.id})"><span>${r.Nome} ${cat ? `<small>(${cat.Nome})</small>` : ''}</span><span>${r.Ativo ? '✅' : '❌'}</span></div>`
    }).join('') || '<p>Nenhum item encontrado.</p>';
}

function renderCardsAndInstallments() {
    const container = document.getElementById('cards-container');
    if (!container) return;
    container.innerHTML = state.cartoes.map(card => {
        const insts = state.parcelamentos.filter(p => p.CartaoId === card.id);
        return `<div class="card-item"><div class="card-item-header"><span style="font-weight:bold;">💳 ${card.Nome}</span><button class="btn-secondary" style="padding:0.2rem 0.5rem;" onclick="openCardModal(${card.id})">✏️</button></div><small>Fechamento: dia ${card.DiaFechamento} | Vencimento: dia ${card.DiaVencimento}</small><div style="margin-top:10px;"><div style="display:flex;justify-content:space-between;border-bottom:1px solid #eee;margin-bottom:5px;"><small>Parcelamentos Ativos:</small><button class="btn-secondary" style="font-size:0.7rem;padding:1px 5px;" onclick="openInstallmentModal(null, ${card.id})">+ Novo</button></div>${insts.map(i => `<div class="installment-row clickable-row" onclick="openInstallmentModal(${i.id})"><span>${i.Descricao}</span><span>${formatCurrency(i.ValorTotal)} (${i.NumeroParcelas}x)</span></div>`).join('') || '<small>Nenhum parcelamento.</small>'}</div></div>`;
    }).join('') || '<p>Nenhum cartão cadastrado.</p>';
}

function renderSettings() {
    const accEl = document.getElementById('accounts-list');
    const catEl = document.getElementById('categories-list');
    if (!accEl || !catEl) return;
    accEl.innerHTML = state.contas.map(c => `<div class="month-row clickable-row" style="padding:0.5rem;" onclick="openAccountModal(${c.id})"><span>${c.Nome}</span><small>${formatCurrency(c.SaldoAtual)}</small></div>`).join('');
    catEl.innerHTML = state.categorias.map(c => `<div class="month-row clickable-row" style="padding:0.5rem;" onclick="openCategoryModal(${c.id})"><span>${c.Nome}</span><small>${c.TipoPadrao}</small></div>`).join('');
}

// --- MODALS ---

window.openRecurringModal = function(id) {
    const item = id ? state.recorrencias.find(r => r.id === id) : { Nome: '', Tipo: 'Saída', CategoriaId: null, Ativo: true };
    selectedItemId = id;
    document.getElementById('modal-item-name').textContent = id ? `Editar: ${item.Nome}` : 'Nova Recorrência';
    document.getElementById('edit-item-nome').value = item.Nome;
    document.getElementById('edit-item-tipo').value = item.Tipo;
    document.getElementById('edit-item-ativo').checked = item.Ativo;
    const catSelect = document.getElementById('edit-item-categoria');
    catSelect.innerHTML = state.categorias.map(c => `<option value="${c.id}" ${Number(c.id) === Number(item.CategoriaId) ? 'selected' : ''}>${c.Nome}</option>`).join('');
    document.getElementById('new-rule-conta').innerHTML = '<option value="">-- Conta --</option>' + state.contas.map(c => `<option value="${c.id}">${c.Nome}</option>`).join('');
    document.getElementById('new-rule-cartao').innerHTML = '<option value="">-- Cartão --</option>' + state.cartoes.map(c => `<option value="${c.id}">${c.Nome}</option>`).join('');
    document.getElementById('rules-section').style.display = id ? 'block' : 'none';
    if (id) renderRules(id);
    document.getElementById('recurring-modal').style.display = 'block';
};

function renderRules(itemId) {
    const listEl = document.getElementById('rules-list');
    const rules = state.recorrenciasRegras.filter(reg => reg.RecorrenciaId === itemId).sort((a, b) => (a.AnoInicio !== b.AnoInicio ? b.AnoInicio - a.AnoInicio : b.MesInicio - a.MesInicio));
    listEl.innerHTML = `<table class="rules-table"><thead><tr><th>Mês/Ano</th><th>Valor</th><th>Dia</th><th>Pagamento</th><th>Ações</th></tr></thead><tbody>${rules.map(reg => {
        const c = state.contas.find(x => x.id === reg.ContaId);
        const cr = state.cartoes.find(x => x.id === reg.CartaoId);
        return `<tr><td>${reg.MesInicio}/${reg.AnoInicio}</td><td>${formatCurrency(reg.Valor)}</td><td>${reg.DiaVencimento}</td><td>${cr ? `💳 ${cr.Nome}` : (c ? `🏦 ${c.Nome}` : '-')}</td><td><button class="btn-secondary" style="padding:0.2rem 0.5rem;font-size:0.8rem;margin-right:0.3rem;" onclick="editRule(${reg.id})">✏️</button><button class="btn-danger-small" onclick="deleteRule(${reg.id})">Excluir</button></td></tr>`
    }).join('')}</tbody></table>`;
}

window.editRule = function(id) {
    const r = state.recorrenciasRegras.find(x => x.id === id); if (!r) return;
    document.getElementById('rule-form-title').textContent = 'Editar Regra';
    document.getElementById('edit-rule-id').value = r.id;
    document.getElementById('new-rule-mes').value = r.MesInicio;
    document.getElementById('new-rule-ano').value = r.AnoInicio;
    document.getElementById('new-rule-valor').value = r.Valor;
    document.getElementById('new-rule-dia').value = r.DiaVencimento;
    document.getElementById('new-rule-conta').value = r.ContaId || '';
    document.getElementById('new-rule-cartao').value = r.CartaoId || '';
    document.getElementById('add-rule-btn').textContent = 'Salvar Alterações';
    document.getElementById('cancel-rule-edit-btn').style.display = 'inline-block';
};

function resetRuleForm() {
    document.getElementById('rule-form-title').textContent = 'Nova Regra';
    document.getElementById('edit-rule-id').value = '';
    ['new-rule-mes','new-rule-ano','new-rule-valor','new-rule-dia','new-rule-conta','new-rule-cartao'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('add-rule-btn').textContent = 'Salvar Regra';
    document.getElementById('cancel-rule-edit-btn').style.display = 'none';
}

document.getElementById('cancel-rule-edit-btn').onclick = resetRuleForm;

document.getElementById('save-item-btn').onclick = async () => {
    const data = { Nome: document.getElementById('edit-item-nome').value, Tipo: document.getElementById('edit-item-tipo').value, CategoriaId: parseInt(document.getElementById('edit-item-categoria').value), Ativo: document.getElementById('edit-item-ativo').checked };
    await saveToGrist('Recorrencias', selectedItemId, data);
};

document.getElementById('add-rule-btn').onclick = async () => {
    const editId = document.getElementById('edit-rule-id').value;
    const data = { RecorrenciaId: selectedItemId, MesInicio: parseInt(document.getElementById('new-rule-mes').value), AnoInicio: parseInt(document.getElementById('new-rule-ano').value), Valor: parseFloat(document.getElementById('new-rule-valor').value), DiaVencimento: parseInt(document.getElementById('new-rule-dia').value), ContaId: parseInt(document.getElementById('new-rule-conta').value) || null, CartaoId: parseInt(document.getElementById('new-rule-cartao').value) || null };
    if (isNaN(data.MesInicio) || isNaN(data.AnoInicio) || isNaN(data.Valor)) return alert('Preencha os campos obrigatórios.');
    await saveToGrist('RecorrenciasRegras', editId, data);
    resetRuleForm();
};

window.deleteRule = async function(id) { if (confirm('Excluir?')) await grist.docApi.applyUserActions([['RemoveRecord', 'RecorrenciasRegras', id]]); await fetchData(); };

window.openTransactionModal = function(id) {
    const t = id ? state.transacoes.find(x => x.id === id) : { Descricao: '', Valor: 0, Tipo: 'Saída', Status: 'Pendente', Data: new Date().toISOString().split('T')[0] };
    const body = `<div class="modal-body-form"><div class="form-group"><label>Descrição</label><input type="text" id="t-desc" value="${t.Descricao}"></div><div class="form-row"><div class="form-group" style="flex:1;"><label>Valor</label><input type="number" id="t-val" value="${t.Valor}"></div><div class="form-group" style="flex:1;"><label>Data</label><input type="date" id="t-data" value="${new Date(t.Data).toISOString().split('T')[0]}"></div></div><div class="form-row"><div class="form-group" style="flex:1;"><label>Conta</label><select id="t-conta">${state.contas.map(c => `<option value="${c.id}" ${c.id === t.ContaId ? 'selected' : ''}>${c.Nome}</option>`).join('')}</select></div><div class="form-group" style="flex:1;"><label>Categoria</label><select id="t-cat">${state.categorias.map(c => `<option value="${c.id}" ${c.id === t.CategoriaId ? 'selected' : ''}>${c.Nome}</option>`).join('')}</select></div></div></div>`;
    openGenericModal(id ? 'Editar Transação' : 'Nova Transação', body, async () => {
        await saveToGrist('Transacoes', id, { Descricao: document.getElementById('t-desc').value, Valor: parseFloat(document.getElementById('t-val').value), Data: document.getElementById('t-data').value, ContaId: parseInt(document.getElementById('t-conta').value), CategoriaId: parseInt(document.getElementById('t-cat').value), Tipo: t.Tipo, Status: t.Status });
    });
};

window.openCardModal = function(id) {
    const c = id ? state.cartoes.find(x => x.id === id) : { Nome: '', DiaFechamento: 25, DiaVencimento: 10, ContaId: null };
    const body = `<div class="modal-body-form"><div class="form-group"><label>Nome</label><input type="text" id="c-nome" value="${c.Nome}"></div><div class="form-row"><div class="form-group" style="flex:1;"><label>Dia Fechamento</label><input type="number" id="c-fech" value="${c.DiaFechamento}"></div><div class="form-group" style="flex:1;"><label>Dia Vencimento</label><input type="number" id="c-venc" value="${c.DiaVencimento}"></div></div><div class="form-group"><label>Conta p/ Pagamento</label><select id="c-conta">${state.contas.map(acc => `<option value="${acc.id}" ${acc.id === c.ContaId ? 'selected' : ''}>${acc.Nome}</option>`).join('')}</select></div></div>`;
    openGenericModal(id ? 'Editar Cartão' : 'Novo Cartão', body, async () => {
        await saveToGrist('Cartoes', id, { Nome: document.getElementById('c-nome').value, DiaFechamento: parseInt(document.getElementById('c-fech').value), DiaVencimento: parseInt(document.getElementById('c-venc').value), ContaId: parseInt(document.getElementById('c-conta').value) });
    });
};

window.openInstallmentModal = function(id, cardId) {
    const p = id ? state.parcelamentos.find(x => x.id === id) : { Descricao: '', ValorTotal: 0, NumeroParcelas: 1, DataCompra: new Date().toISOString().split('T')[0], CartaoId: cardId };
    const body = `<div class="modal-body-form"><div class="form-group"><label>Descrição</label><input type="text" id="p-desc" value="${p.Descricao}"></div><div class="form-row"><div class="form-group" style="flex:1;"><label>Valor Total</label><input type="number" id="p-val" value="${p.ValorTotal}"></div><div class="form-group" style="flex:1;"><label>Parcelas</label><input type="number" id="p-num" value="${p.NumeroParcelas}"></div></div><div class="form-group"><label>Data da Compra</label><input type="date" id="p-data" value="${new Date(p.DataCompra).toISOString().split('T')[0]}"></div><div class="form-group"><label>Cartão</label><select id="p-card">${state.cartoes.map(c => `<option value="${c.id}" ${c.id === p.CartaoId ? 'selected' : ''}>${c.Nome}</option>`).join('')}</select></div></div>`;
    openGenericModal(id ? 'Editar Parcelamento' : 'Novo Parcelamento', body, async () => {
        await saveToGrist('Parcelamentos', id, { Descricao: document.getElementById('p-desc').value, ValorTotal: parseFloat(document.getElementById('p-val').value), NumeroParcelas: parseInt(document.getElementById('p-num').value), DataCompra: document.getElementById('p-data').value, CartaoId: parseInt(document.getElementById('p-card').value) });
    });
};

window.openAccountModal = function(id) {
    const c = id ? state.contas.find(x => x.id === id) : { Nome: '', Tipo: 'Corrente', SaldoInicial: 0, Ativa: true };
    const body = `<div class="modal-body-form"><div class="form-group"><label>Nome</label><input type="text" id="a-nome" value="${c.Nome}"></div><div class="form-row"><div class="form-group" style="flex:1;"><label>Tipo</label><select id="a-tipo"><option value="Corrente" ${c.Tipo === 'Corrente' ? 'selected' : ''}>Corrente</option><option value="Poupança" ${c.Tipo === 'Poupança' ? 'selected' : ''}>Poupança</option><option value="Carteira" ${c.Tipo === 'Carteira' ? 'selected' : ''}>Carteira</option></select></div><div class="form-group" style="flex:1;"><label>Saldo Inicial</label><input type="number" id="a-saldo" value="${c.SaldoInicial}"></div></div></div>`;
    openGenericModal(id ? 'Editar Conta' : 'Nova Conta', body, async () => {
        await saveToGrist('Contas', id, { Nome: document.getElementById('a-nome').value, Tipo: document.getElementById('a-tipo').value, SaldoInicial: parseFloat(document.getElementById('a-saldo').value), Ativa: true });
    });
};

window.openCategoryModal = function(id) {
    const c = id ? state.categorias.find(x => x.id === id) : { Nome: '', TipoPadrao: 'Saída' };
    const body = `<div class="modal-body-form"><div class="form-group"><label>Nome</label><input type="text" id="cat-nome" value="${c.Nome}"></div><div class="form-group"><label>Tipo Padrão</label><select id="cat-tipo"><option value="Entrada" ${c.TipoPadrao === 'Entrada' ? 'selected' : ''}>Entrada</option><option value="Saída" ${c.TipoPadrao === 'Saída' ? 'selected' : ''}>Saída</option></select></div></div>`;
    openGenericModal(id ? 'Editar Categoria' : 'Nova Categoria', body, async () => {
        await saveToGrist('Categorias', id, { Nome: document.getElementById('cat-nome').value, TipoPadrao: document.getElementById('cat-tipo').value });
    });
};

function openGenericModal(title, bodyHtml, onSave) {
    document.getElementById('generic-modal-title').textContent = title;
    document.getElementById('generic-modal-body').innerHTML = bodyHtml;
    document.getElementById('generic-modal-save').onclick = async () => { await onSave(); document.getElementById('generic-modal').style.display = 'none'; };
    document.getElementById('generic-modal').style.display = 'block';
}

async function saveToGrist(table, id, data) {
    updateStatus('Salvando...');
    try {
        const action = id ? ['UpdateRecord', table, parseInt(id), data] : ['AddRecord', table, null, data];
        await grist.docApi.applyUserActions([action]);
        await fetchData();
    } catch (e) { alert('Erro: ' + e.message); }
}

window.openMonthModal = function(index) {
    const data = state.predictionDetails[index]; if (!data) return;
    document.getElementById('modal-month-name').textContent = `Detalhamento: ${data.monthName}`;
    document.getElementById('month-total-in').textContent = formatCurrency(data.totalIn);
    document.getElementById('month-total-out').textContent = formatCurrency(data.totalOut);
    const result = data.totalIn - data.totalOut;
    const resEl = document.getElementById('month-net-result');
    resEl.textContent = formatCurrency(result); resEl.className = result >= 0 ? 'positive' : 'negative';
    document.getElementById('month-in-list').innerHTML = data.events.filter(e => e.valor > 0).map(e => `<div class="event-row in"><span class="event-date">${e.dia}</span><span class="event-desc">${e.descricao}</span><span class="event-val">${formatCurrency(e.valor)}</span></div>`).join('') || '<p>Nenhuma entrada.</p>';
    document.getElementById('month-out-list').innerHTML = data.events.filter(e => e.valor < 0).map(e => `<div class="event-row out"><span class="event-date">${e.dia}</span><span class="event-desc">${e.descricao}</span><span class="event-val">${formatCurrency(Math.abs(e.valor))}</span></div>`).join('') || '<p>Nenhuma saída.</p>';
    document.getElementById('month-modal').style.display = 'block';
};

document.querySelectorAll('.close-modal').forEach(btn => {
    btn.onclick = () => { document.getElementById(btn.getAttribute('data-modal')).style.display = 'none'; if (btn.getAttribute('data-modal') === 'recurring-modal') resetRuleForm(); };
});

window.onclick = (event) => { if (event.target.className === 'modal') { event.target.style.display = 'none'; if (event.target.id === 'recurring-modal') resetRuleForm(); } };
