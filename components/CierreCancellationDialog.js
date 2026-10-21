import { useEffect, useRef, useState } from 'react';
import { motivoCancelacionValido } from '../lib/cierreCancellation';

export default function CierreCancellationDialog({ cierre, busy, error, onClose, onConfirm }) {
  const dialog = useRef(null);
  const [motivo, setMotivo] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  useEffect(() => {
    dialog.current.showModal();
    return () => dialog.current?.close();
  }, []);
  return <dialog ref={dialog} aria-labelledby="cancelacion-title" aria-describedby="cancelacion-description"
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
    style={{ width: 'calc(100% - 32px)', maxWidth: 500, boxSizing: 'border-box', maxHeight: '90vh', overflowY: 'auto', padding: 24, border: '1px solid #e5e7eb', borderRadius: 16, color: '#1a1a2e' }}>
    <style>{`dialog::backdrop { background: rgba(15,23,42,.55); }`}</style>
    <form onSubmit={event => { event.preventDefault(); if (!busy && confirmed && motivoCancelacionValido(motivo)) onConfirm(motivo.trim()); }}>
      <h2 id="cancelacion-title" style={{ margin: '0 0 12px', fontSize: 20 }}>Cancelar cierre #{cierre.id}</h2>
      <p style={{ overflowWrap: 'anywhere', fontWeight: 700 }}>{cierre.propiedad}</p>
      <p>Asesor original: {cierre.vendedor || 'Sin asignar'}</p>
      <p id="cancelacion-description" style={{ fontSize: 14, lineHeight: 1.5 }}>El cierre quedará en el historial como cancelado y se excluirá de KPIs, comisiones y reportes vigentes. Se conservarán su atribución comercial, documentos, recibos y firmas. Esta acción no se puede deshacer desde la aplicación.</p>
      <label htmlFor="cancelacion-motivo" style={{ display: 'block', fontWeight: 700, marginBottom: 8 }}>Motivo obligatorio</label>
      <textarea id="cancelacion-motivo" autoFocus required minLength={10} maxLength={1000} rows={4} value={motivo} disabled={busy}
        aria-describedby="cancelacion-length" onChange={event => setMotivo(event.target.value)}
        style={{ width: '100%', boxSizing: 'border-box', font: 'inherit', padding: 12, border: '1px solid #9ca3af', borderRadius: 8, resize: 'vertical' }} />
      <p id="cancelacion-length" style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>De 10 a 1000 caracteres. {motivo.trim().length}/1000</p>
      <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', margin: '18px 0', fontSize: 14, lineHeight: 1.5 }}>
        <input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} style={{ marginTop: 4 }} />
        Confirmo la cancelación administrativa de este cierre y la conservación de su historial.
      </label>
      {error && <p role="alert" style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', padding: 12, borderRadius: 8, fontSize: 14, lineHeight: 1.5 }}>{error}</p>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'flex-end' }}>
        <button type="button" disabled={busy} onClick={onClose} style={{ padding: '12px 16px', border: '1px solid #d1d5db', borderRadius: 8, background: '#fff', color: '#374151', fontWeight: 700 }}>Volver sin cambios</button>
        <button type="submit" disabled={busy || !confirmed || !motivoCancelacionValido(motivo)} style={{ padding: '12px 16px', border: 0, borderRadius: 8, background: '#991b1b', color: '#fff', fontWeight: 700, opacity: busy || !confirmed || !motivoCancelacionValido(motivo) ? .5 : 1 }}>{busy ? 'Cancelando…' : 'Confirmar cancelación'}</button>
      </div>
    </form>
  </dialog>;
}
