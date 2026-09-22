import type { ContentAuditMode, ContentAuditStatus } from '../services/api/contentAudit';

type ModeStatus = Pick<ContentAuditStatus, 'mode' | 'enabled' | 'audit_only' | 'ready'>;

// Observation is a legacy override, not simple enforcement or a disabled audit.
export function activeAuditMode(status: ModeStatus | null): ContentAuditMode | null {
  if (!status) return null;
  if (!status.enabled || status.mode === 'off') return 'off';
  if (status.audit_only) return null;
  return status.mode === 'simple' ? 'simple' : 'strict';
}

export function supportsAuditModes(status: ModeStatus | null): boolean {
  return !!status && ['strict', 'simple', 'off'].includes(status.mode ?? '');
}

// Saving config schedules an asynchronous backend reload. Confirm runtime state
// separately and leave a pending warning when the runtime cannot be verified.
export async function confirmAuditMode(
  mode: ContentAuditMode,
  readStatus: () => Promise<ContentAuditStatus>,
  onStatus: (status: ContentAuditStatus) => void,
  pause: () => Promise<void> = () => new Promise((resolve) => setTimeout(resolve, 400))
): Promise<boolean> {
  for (let attempt = 0; attempt < 8; attempt++) {
    if (attempt > 0) await pause();
    try {
      const status = await readStatus();
      onStatus(status);
      if (activeAuditMode(status) === mode && (mode === 'off' || status.ready)) return true;
    } catch {
      return false;
    }
  }
  return false;
}
