const STORAGE_KEY = 'mis_finanzas_data_v1';

const CATEGORIAS_DEFAULT = [
    { id: 1, nombre: 'Comida', tipo: 'gasto' },
    { id: 2, nombre: 'Transporte', tipo: 'gasto' },
    { id: 3, nombre: 'Escuela / Trabajo', tipo: 'gasto' },
    { id: 4, nombre: 'Salidas / Ocio', tipo: 'gasto' },
    { id: 5, nombre: 'Servicios / Suscripciones', tipo: 'gasto' },
    { id: 6, nombre: 'Otros Gastos', tipo: 'gasto' },
    { id: 7, nombre: 'Sueldo / Ingreso', tipo: 'ingreso' },
    { id: 8, nombre: 'Ajuste', tipo: 'gasto' }
];

let db = {
    cuentas: [],
    movimientos: [],
    categorias: CATEGORIAS_DEFAULT
};

// --- PERSISTENCIA LOCAL ---
function cargarDB() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
        try {
            const parsed = JSON.parse(raw);
            db.cuentas = parsed.cuentas || [];
            db.movimientos = parsed.movimientos || [];
            db.categorias = parsed.categorias || CATEGORIAS_DEFAULT;
        } catch (e) {
            console.error('Error leyendo localStorage', e);
        }
    }
}

function guardarDB() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
}

const formatoMoneda = (num) => {
    return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(num || 0);
};

const hoyISO = () => {
    const d = new Date();
    const offset = d.getTimezoneOffset();
    const local = new Date(d.getTime() - (offset * 60 * 1000));
    return local.toISOString().split('T')[0];
};

// --- LÓGICA FINANCIERA Y CORTES TDC ---
function calcularPagoCorte(cuentaId, diaCorte) {
    if (!diaCorte) return 0;
    const hoy = new Date();
    const anio = hoy.getFullYear();
    const mes = hoy.getMonth(); // 0-11
    const dia = hoy.getDate();

    let inicioPeriodo;
    if (dia > diaCorte) {
        const ultimoDiaMes = new Date(anio, mes + 1, 0).getDate();
        inicioPeriodo = new Date(anio, mes, Math.min(diaCorte, ultimoDiaMes));
    } else {
        const mesAnt = mes === 0 ? 11 : mes - 1;
        const anioAnt = mes === 0 ? anio - 1 : anio;
        const ultimoDiaMesAnt = new Date(anioAnt, mesAnt + 1, 0).getDate();
        inicioPeriodo = new Date(anioAnt, mesAnt, Math.min(diaCorte, ultimoDiaMesAnt));
    }

    const inicioStr = inicioPeriodo.toISOString().split('T')[0];
    const total = db.movimientos
        .filter(m => m.cuenta_origen_id === cuentaId && m.tipo === 'gasto' && m.fecha > inicioStr)
        .reduce((acc, m) => acc + m.monto, 0);

    return Math.round(total * 100) / 100;
}

function aplicarEfectoSaldo(tipo, monto, origenId, destinoId, revertir = false) {
    const factor = revertir ? -1 : 1;
    const origen = db.cuentas.find(c => c.id === origenId);
    if (!origen) throw new Error('Cuenta origen no encontrada');

    if (tipo === 'gasto') {
        if (origen.tipo === 'efectivo' || origen.tipo === 'debito') {
            origen.saldo_actual -= monto * factor;
        } else if (origen.tipo === 'credito') {
            origen.saldo_actual += monto * factor;
        }
    } else if (tipo === 'ingreso') {
        if (origen.tipo === 'efectivo' || origen.tipo === 'debito') {
            origen.saldo_actual += monto * factor;
        } else {
            throw new Error("Usa 'Transfer / Pagar TDC' para abonar a una tarjeta de crédito");
        }
    } else if (tipo === 'transferencia') {
        const destino = db.cuentas.find(c => c.id === destinoId);
        if (!destino) throw new Error('Cuenta destino no encontrada');

        origen.saldo_actual -= monto * factor;
        if (destino.tipo === 'credito') {
            destino.saldo_actual -= monto * factor;
        } else {
            destino.saldo_actual += monto * factor;
        }
    }
}

// --- RENDERIZADO DE PANTALLA ---
function renderizarTodo() {
    if (db.cuentas.length === 0) {
        document.getElementById('vista-onboarding').classList.remove('hidden');
        document.getElementById('vista-principal').classList.add('hidden');
        return;
    }

    document.getElementById('vista-onboarding').classList.add('hidden');
    document.getElementById('vista-principal').classList.remove('hidden');

    let liquidez = 0;
    let deudaTDC = 0;

    db.cuentas.forEach(c => {
        if (c.tipo === 'efectivo' || c.tipo === 'debito') liquidez += c.saldo_actual;
        if (c.tipo === 'credito') deudaTDC += c.saldo_actual;
    });

    document.getElementById('res-liquidez').textContent = formatoMoneda(liquidez);
    document.getElementById('res-deuda').textContent = formatoMoneda(deudaTDC);
    document.getElementById('res-disponible').textContent = formatoMoneda(liquidez - deudaTDC);

    renderizarSelectores();
    renderizarCuentas();
    renderizarMovimientos();
}

function renderizarSelectores() {
    const origen = document.getElementById('mov-origen');
    const destino = document.getElementById('mov-destino');
    const categoria = document.getElementById('mov-categoria');
    const tipoMov = document.getElementById('mov-tipo').value;

    origen.innerHTML = '';
    destino.innerHTML = '';

    db.cuentas.forEach(c => {
        if (tipoMov === 'ingreso' && c.tipo === 'credito') return;
        const opt = `<option value="${c.id}">${c.nombre} (${formatoMoneda(c.saldo_actual)})</option>`;
        origen.innerHTML += opt;
        destino.innerHTML += opt;
    });

    categoria.innerHTML = '';
    db.categorias
        .filter(cat => cat.tipo === (tipoMov === 'ingreso' ? 'ingreso' : 'gasto'))
        .forEach(cat => {
            categoria.innerHTML += `<option value="${cat.id}">${cat.nombre}</option>`;
        });
}

function renderizarCuentas() {
    const contenedor = document.getElementById('lista-cuentas');
    contenedor.innerHTML = '';

    db.cuentas.forEach(c => {
        if (c.tipo === 'credito') {
            const disponibleTDC = (c.limite_credito || 0) - c.saldo_actual;
            const trasCorte = calcularPagoCorte(c.id, c.dia_corte);
            contenedor.innerHTML += `
                <div class="bg-slate-950 border border-slate-800 p-3.5 rounded-xl space-y-1">
                    <div class="flex justify-between items-center">
                        <span class="font-semibold text-sm">💳 ${c.nombre}</span>
                        <div class="flex items-center gap-2">
                            <span class="text-rose-400 font-bold text-sm">Deuda: ${formatoMoneda(c.saldo_actual)}</span>
                            <button onclick="eliminarCuenta(${c.id}, '${c.nombre}')" title="Borrar cuenta" class="text-slate-500 hover:text-rose-500 text-xs p-1">🗑️</button>
                        </div>
                    </div>
                    <div class="flex justify-between text-xs text-slate-400">
                        <span>Corte: día ${c.dia_corte || '-'} | Pago: día ${c.dia_pago || '-'}</span>
                        <span>Disp: ${formatoMoneda(disponibleTDC)}</span>
                    </div>
                    <div class="text-xs text-amber-400 pt-1">
                        Acumulado tras último corte: <b>${formatoMoneda(trasCorte)}</b>
                    </div>
                </div>
            `;
        } else {
            const icono = c.tipo === 'efectivo' ? '💵' : '🏦';
            contenedor.innerHTML += `
                <div class="bg-slate-950 border border-slate-800 p-3.5 rounded-xl flex justify-between items-center">
                    <span class="font-semibold text-sm">${icono} ${c.nombre}</span>
                    <div class="flex items-center gap-2">
                        <span class="text-emerald-400 font-bold text-sm">${formatoMoneda(c.saldo_actual)}</span>
                        <button onclick="eliminarCuenta(${c.id}, '${c.nombre}')" title="Borrar cuenta" class="text-slate-500 hover:text-rose-500 text-xs p-1">🗑️</button>
                    </div>
                </div>
            `;
        }
    });
}

function renderizarMovimientos() {
    const contenedor = document.getElementById('lista-movimientos');
    const recientes = [...db.movimientos].sort((a, b) => b.fecha.localeCompare(a.fecha) || b.id - a.id).slice(0, 30);

    if (recientes.length === 0) {
        contenedor.innerHTML = '<p class="text-xs text-slate-500 py-3">Aún no hay movimientos registrados.</p>';
        return;
    }

    contenedor.innerHTML = recientes.map(m => {
        const cOrigen = db.cuentas.find(c => c.id === m.cuenta_origen_id)?.nombre || 'Cuenta';
        const cDestino = db.cuentas.find(c => c.id === m.cuenta_destino_id)?.nombre || '';
        const catNombre = db.categorias.find(cat => cat.id === m.categoria_id)?.nombre || '';

        let color = m.tipo === 'ingreso' ? 'text-emerald-400' : (m.tipo === 'gasto' ? 'text-rose-400' : 'text-sky-400');
        let signo = m.tipo === 'ingreso' ? '+' : (m.tipo === 'gasto' ? '-' : '⇄');
        let detalle = m.tipo === 'transferencia' ? `${cOrigen} → ${cDestino}` : `${catNombre} • ${cOrigen}`;

        return `
            <div class="py-2.5 flex justify-between items-center text-sm gap-2">
                <div class="min-w-0 flex-1">
                    <p class="font-medium text-slate-200 truncate">${m.nota || catNombre || 'Movimiento'}</p>
                    <p class="text-xs text-slate-400">${m.fecha} • ${detalle}</p>
                </div>
                <div class="flex items-center gap-3">
                    <span class="font-bold ${color}">${signo}${formatoMoneda(m.monto)}</span>
                    <button onclick="abrirModalEditar(${m.id})" title="Editar" class="text-slate-400 hover:text-amber-400 text-xs p-1">✏️</button>
                    <button onclick="eliminarMovimiento(${m.id})" title="Borrar" class="text-slate-400 hover:text-rose-500 text-xs p-1">🗑️</button>
                </div>
            </div>
        `;
    }).join('');
}

// --- EVENTOS Y ACCIONES ---
function setTipoMov(tipo) {
    document.getElementById('mov-tipo').value = tipo;
    ['gasto', 'ingreso', 'transferencia'].forEach(t => {
        const btn = document.getElementById(`btn-tipo-${t}`);
        if (t === tipo) {
            btn.className = 'py-2 rounded-lg text-sm font-semibold ' + 
                (t === 'gasto' ? 'bg-rose-500 text-white' : t === 'ingreso' ? 'bg-emerald-500 text-slate-950' : 'bg-sky-500 text-slate-950');
        } else {
            btn.className = 'py-2 rounded-lg text-sm font-semibold text-slate-400';
        }
    });

    const esTransfer = tipo === 'transferencia';
    document.getElementById('div-destino').classList.toggle('hidden', !esTransfer);
    document.getElementById('div-categoria').classList.toggle('hidden', esTransfer);
    document.getElementById('lbl-origen').textContent = esTransfer ? 'Desde cuenta' : 'Cuenta';
    renderizarSelectores();
}

function abrirModalCuenta() { document.getElementById('modal-cuenta').classList.remove('hidden'); }
function cerrarModalCuenta() { document.getElementById('modal-cuenta').classList.add('hidden'); }
function abrirModalBackup() { document.getElementById('modal-backup').classList.remove('hidden'); }
function cerrarModalBackup() { document.getElementById('modal-backup').classList.add('hidden'); }

function toggleCamposTDC() {
    const tipo = document.getElementById('cta-tipo').value;
    const esTDC = tipo === 'credito';
    document.getElementById('campos-tdc').classList.toggle('hidden', !esTDC);
    document.getElementById('lbl-saldo-inicial').textContent = esTDC ? 'Deuda actual ya usada ($)' : 'Saldo actual disponible ($)';
}

document.getElementById('form-cuenta').addEventListener('submit', (e) => {
    e.preventDefault();
    const tipo = document.getElementById('cta-tipo').value;
    const nuevaCuenta = {
        id: Date.now(),
        nombre: document.getElementById('cta-nombre').value,
        tipo: tipo,
        saldo_actual: parseFloat(document.getElementById('cta-saldo').value) || 0,
        limite_credito: tipo === 'credito' ? parseFloat(document.getElementById('cta-limite').value) || 0 : 0,
        dia_corte: tipo === 'credito' ? parseInt(document.getElementById('cta-corte').value) || null : null,
        dia_pago: tipo === 'credito' ? parseInt(document.getElementById('cta-pago').value) || null : null
    };

    db.cuentas.push(nuevaCuenta);
    guardarDB();
    e.target.reset();
    toggleCamposTDC();
    cerrarModalCuenta();
    renderizarTodo();
});

function eliminarCuenta(id, nombre) {
    if (!confirm(`¿Seguro que quieres borrar "${nombre}" y todos sus movimientos?`)) return;
    db.movimientos = db.movimientos.filter(m => m.cuenta_origen_id !== id && m.cuenta_destino_id !== id);
    db.cuentas = db.cuentas.filter(c => c.id !== id);
    guardarDB();
    renderizarTodo();
}

document.getElementById('form-movimiento').addEventListener('submit', (e) => {
    e.preventDefault();
    const tipo = document.getElementById('mov-tipo').value;
    const monto = parseFloat(document.getElementById('mov-monto').value);
    const origenId = parseInt(document.getElementById('mov-origen').value);
    const destinoId = tipo === 'transferencia' ? parseInt(document.getElementById('mov-destino').value) : null;
    const categoriaId = tipo !== 'transferencia' ? parseInt(document.getElementById('mov-categoria').value) : null;

    if (monto <= 0) return alert('El monto debe ser mayor a 0');
    if (tipo === 'transferencia' && origenId === destinoId) return alert('La cuenta origen y destino no pueden ser la misma');

    try {
        aplicarEfectoSaldo(tipo, monto, origenId, destinoId, false);
        db.movimientos.push({
            id: Date.now(),
            monto,
            tipo,
            fecha: hoyISO(),
            nota: document.getElementById('mov-nota').value.trim(),
            cuenta_origen_id: origenId,
            cuenta_destino_id: destinoId,
            categoria_id: categoriaId
        });
        guardarDB();
        document.getElementById('mov-monto').value = '';
        document.getElementById('mov-nota').value = '';
        renderizarTodo();
    } catch (err) {
        alert(err.message);
    }
});

function eliminarMovimiento(id) {
    if (!confirm('¿Seguro que quieres borrar este movimiento? Se restaurará el saldo de tu cuenta.')) return;
    const mov = db.movimientos.find(m => m.id === id);
    if (!mov) return;

    aplicarEfectoSaldo(mov.tipo, mov.monto, mov.cuenta_origen_id, mov.cuenta_destino_id, true);
    db.movimientos = db.movimientos.filter(m => m.id !== id);
    guardarDB();
    renderizarTodo();
}

function abrirModalEditar(id) {
    const mov = db.movimientos.find(m => m.id === id);
    if (!mov) return;

    document.getElementById('edit-id').value = mov.id;
    document.getElementById('edit-tipo').value = mov.tipo;
    document.getElementById('edit-monto').value = mov.monto;
    document.getElementById('edit-fecha').value = mov.fecha;
    document.getElementById('edit-nota').value = mov.nota || '';

    const origen = document.getElementById('edit-origen');
    const destino = document.getElementById('edit-destino');
    const categoria = document.getElementById('edit-categoria');

    origen.innerHTML = '';
    destino.innerHTML = '';
    db.cuentas.forEach(c => {
        if (mov.tipo === 'ingreso' && c.tipo === 'credito') return;
        origen.innerHTML += `<option value="${c.id}" ${c.id === mov.cuenta_origen_id ? 'selected' : ''}>${c.nombre}</option>`;
        destino.innerHTML += `<option value="${c.id}" ${c.id === mov.cuenta_destino_id ? 'selected' : ''}>${c.nombre}</option>`;
    });

    const esTransfer = mov.tipo === 'transferencia';
    document.getElementById('edit-div-destino').classList.toggle('hidden', !esTransfer);
    document.getElementById('edit-div-categoria').classList.toggle('hidden', esTransfer);

    if (!esTransfer) {
        categoria.innerHTML = '';
        db.categorias
            .filter(cat => cat.tipo === mov.tipo)
            .forEach(cat => {
                categoria.innerHTML += `<option value="${cat.id}" ${cat.id === mov.categoria_id ? 'selected' : ''}>${cat.nombre}</option>`;
            });
    }

    document.getElementById('modal-editar-mov').classList.remove('hidden');
}

function cerrarModalEditar() { document.getElementById('modal-editar-mov').classList.add('hidden'); }

document.getElementById('form-editar-mov').addEventListener('submit', (e) => {
    e.preventDefault();
    const id = parseInt(document.getElementById('edit-id').value);
    const movAnterior = db.movimientos.find(m => m.id === id);
    if (!movAnterior) return;

    const nuevoMonto = parseFloat(document.getElementById('edit-monto').value);
    const nuevoOrigen = parseInt(document.getElementById('edit-origen').value);
    const nuevoDestino = movAnterior.tipo === 'transferencia' ? parseInt(document.getElementById('edit-destino').value) : null;
    const nuevaCat = movAnterior.tipo !== 'transferencia' ? parseInt(document.getElementById('edit-categoria').value) : null;

    if (nuevoMonto <= 0) return alert('El monto debe ser mayor a 0');

    // Revertir anterior y aplicar nuevo
    aplicarEfectoSaldo(movAnterior.tipo, movAnterior.monto, movAnterior.cuenta_origen_id, movAnterior.cuenta_destino_id, true);
    aplicarEfectoSaldo(movAnterior.tipo, nuevoMonto, nuevoOrigen, nuevoDestino, false);

    movAnterior.monto = nuevoMonto;
    movAnterior.fecha = document.getElementById('edit-fecha').value;
    movAnterior.nota = document.getElementById('edit-nota').value.trim();
    movAnterior.cuenta_origen_id = nuevoOrigen;
    movAnterior.cuenta_destino_id = nuevoDestino;
    movAnterior.categoria_id = nuevaCat;

    guardarDB();
    cerrarModalEditar();
    renderizarTodo();
});

// --- EXPORTAR PARA PANDAS (CSV) Y BACKUP (JSON) ---
function exportarCSV() {
    if (db.movimientos.length === 0) return alert('No hay movimientos para exportar aún.');

    const encabezados = ['id', 'fecha', 'tipo', 'monto', 'categoria', 'cuenta_origen', 'cuenta_destino', 'nota'];
    const filas = db.movimientos.map(m => {
        const origen = db.cuentas.find(c => c.id === m.cuenta_origen_id)?.nombre || '';
        const destino = db.cuentas.find(c => c.id === m.cuenta_destino_id)?.nombre || '';
        const cat = db.categorias.find(c => c.id === m.categoria_id)?.nombre || '';
        const notaLimpia = `"${(m.nota || '').replace(/"/g, '""')}"`;
        return [m.id, m.fecha, m.tipo, m.monto, `"${cat}"`, `"${origen}"`, `"${destino}"`, notaLimpia].join(',');
    });

    const csvContenido = '\uFEFF' + [encabezados.join(','), ...filas].join('\n');
    descargarArchivo(csvContenido, `finanzas_${hoyISO()}.csv`, 'text/csv;charset=utf-8;');
}

function exportarJSON() {
    const jsonContenido = JSON.stringify(db, null, 2);
    descargarArchivo(jsonContenido, `respaldo_finanzas_${hoyISO()}.json`, 'application/json');
}

function importarJSON(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const importado = JSON.parse(e.target.result);
            if (!Array.isArray(importado.cuentas) || !Array.isArray(importado.movimientos)) {
                throw new Error('Formato de respaldo inválido');
            }
            db = importado;
            guardarDB();
            cerrarModalBackup();
            renderizarTodo();
            alert('¡Respaldo restaurado con éxito!');
        } catch (err) {
            alert('Error al leer el archivo: ' + err.message);
        }
    };
    reader.readAsText(file);
}

function descargarArchivo(contenido, nombreArchivo, tipoMime) {
    const blob = new Blob([contenido], { type: tipoMime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nombreArchivo;
    a.click();
    URL.revokeObjectURL(url);
}

// Iniciar app
cargarDB();
renderizarTodo();