import { useState } from 'react';
import { exportLocalBackup } from '../lib/localBackup';

type BackupStatus = ReturnType<typeof exportLocalBackup> | null;

export function LocalBackup() {
  const [status, setStatus] = useState<BackupStatus>(null);
  return (
    <section className="local-backup" aria-label="Copia de seguridad local">
      <h3>Copia de seguridad local</h3>
      <p>El archivo JSON no está cifrado y contiene datos de empleados y salarios. Guárdalo en un lugar seguro.</p>
      <p>La copia incluye solo lo persistido en este navegador; si falló un guardado, los cambios que solo están en memoria pueden faltar.</p>
      <button className="subtle" type="button" onClick={() => setStatus(exportLocalBackup())}>
        Exportar copia local (JSON)
      </button>
      {status === 'requested' && <p role="status">Se solicitó la descarga. Comprueba que el navegador haya guardado el archivo.</p>}
      {status === 'read-failed' && <p role="status">No se pudieron leer todas las claves locales; no se generó la copia.</p>}
      {status === 'download-failed' && <p role="status">No se pudo completar la solicitud de descarga. Comprueba las opciones del navegador.</p>}
    </section>
  );
}
