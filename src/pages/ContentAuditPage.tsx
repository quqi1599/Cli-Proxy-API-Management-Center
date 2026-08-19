import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import {
  IconCheck,
  IconDownload,
  IconEye,
  IconFileText,
  IconRefreshCw,
  IconShield,
} from '@/components/ui/icons';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useAuthStore, useNotificationStore } from '@/stores';
import {
  contentAuditApi,
  type ContentAuditEvent,
  type ContentAuditEventDetail,
  type ContentAuditListParams,
  type ContentAuditReviewLabel,
  type ContentAuditStatus,
} from '@/services/api/contentAudit';
import { copyToClipboard } from '@/utils/clipboard';
import { downloadBlob } from '@/utils/download';
import { formatFileSize, formatUnixTimestamp } from '@/utils/format';
import styles from './ContentAuditPage.module.scss';

const PAGE_SIZE = 50;
const REVIEW_LABELS: ContentAuditReviewLabel[] = [
  'unreviewed',
  'confirmed_block',
  'false_positive',
  'needs_policy_change',
  'out_of_scope',
];
const emptyFilters = {
  search: '',
  category: '',
  severity: '',
  review_label: '',
  user_id: '',
  token_id: '',
};
type FilterState = typeof emptyFilters;

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : typeof error === 'string' ? error : '';

const reviewClass = (label: ContentAuditReviewLabel) => styles[`review_${label}`] || '';

const severityClass = (severity: string) => styles[`severity_${severity}`] || '';

export function ContentAuditPage() {
  const { t } = useTranslation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const { showNotification } = useNotificationStore();
  const [status, setStatus] = useState<ContentAuditStatus | null>(null);
  const [events, setEvents] = useState<ContentAuditEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [draftFilters, setDraftFilters] = useState<FilterState>(emptyFilters);
  const [filters, setFilters] = useState<FilterState>(emptyFilters);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [selected, setSelected] = useState<ContentAuditEventDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [evidence, setEvidence] = useState<unknown>(null);
  const [evidenceKey, setEvidenceKey] = useState('');
  const [evidenceReason, setEvidenceReason] = useState('');
  const [revealLoading, setRevealLoading] = useState(false);
  const [reviewLabel, setReviewLabel] = useState<ContentAuditReviewLabel>('unreviewed');
  const [reviewNote, setReviewNote] = useState('');
  const [reviewReason, setReviewReason] = useState('');
  const [reviewLoading, setReviewLoading] = useState(false);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const falsePositiveCount = useMemo(
    () => events.filter((event) => event.review_label === 'false_positive').length,
    [events]
  );
  const encryptedCount = useMemo(
    () => events.filter((event) => event.evidence_status === 'encrypted').length,
    [events]
  );

  const loadData = useCallback(async () => {
    if (connectionStatus !== 'connected') return;
    setLoading(true);
    setLoadError('');
    const params: ContentAuditListParams = { ...filters, page, page_size: PAGE_SIZE };
    try {
      const [nextStatus, list] = await Promise.all([
        contentAuditApi.getStatus(),
        contentAuditApi.listEvents(params),
      ]);
      setStatus(nextStatus);
      setEvents(Array.isArray(list.items) ? list.items : []);
      setTotal(Number(list.total) || 0);
    } catch (error) {
      setLoadError(getErrorMessage(error) || t('content_audit.load_error'));
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [connectionStatus, filters, page, t]);

  useEffect(() => {
    void loadData();
  }, [loadData]);
  useHeaderRefresh(loadData);

  const applyFilters = () => {
    setPage(1);
    setFilters({ ...draftFilters });
  };
  const resetFilters = () => {
    setDraftFilters(emptyFilters);
    setFilters(emptyFilters);
    setPage(1);
  };

  const openDetail = async (event: ContentAuditEvent) => {
    setSelected({ ...event, access_history: [] });
    setReviewLabel(event.review_label);
    setReviewNote(event.review_note || '');
    setReviewReason('');
    setEvidence(null);
    setEvidenceKey('');
    setEvidenceReason('');
    setDetailLoading(true);
    try {
      const detail = await contentAuditApi.getEvent(event.id);
      setSelected(detail);
      setReviewLabel(detail.review_label);
      setReviewNote(detail.review_note || '');
    } catch (error) {
      showNotification(getErrorMessage(error) || t('content_audit.detail_error'), 'error');
    } finally {
      setDetailLoading(false);
    }
  };

  const closeDetail = () => {
    setSelected(null);
    setEvidence(null);
    setEvidenceKey('');
    setEvidenceReason('');
    setReviewReason('');
  };

  const revealEvidence = async () => {
    if (!selected || evidenceReason.trim().length < 4 || !evidenceKey.trim()) {
      showNotification(t('content_audit.reveal_requirements'), 'warning');
      return;
    }
    setRevealLoading(true);
    try {
      const response = await contentAuditApi.revealEvidence(
        selected.id,
        evidenceReason.trim(),
        evidenceKey
      );
      setEvidence(response.evidence);
      setEvidenceKey('');
      setSelected(await contentAuditApi.getEvent(selected.id));
    } catch (error) {
      showNotification(getErrorMessage(error) || t('content_audit.reveal_error'), 'error');
    } finally {
      setRevealLoading(false);
    }
  };

  const saveReview = async () => {
    if (!selected || reviewReason.trim().length < 4) {
      showNotification(t('content_audit.review_reason_required'), 'warning');
      return;
    }
    setReviewLoading(true);
    try {
      await contentAuditApi.reviewEvent(selected.id, {
        label: reviewLabel,
        note: reviewNote,
        reason: reviewReason.trim(),
      });
      setSelected(await contentAuditApi.getEvent(selected.id));
      setReviewReason('');
      showNotification(t('content_audit.review_saved'), 'success');
      await loadData();
    } catch (error) {
      showNotification(getErrorMessage(error) || t('content_audit.review_error'), 'error');
    } finally {
      setReviewLoading(false);
    }
  };

  const evidenceText = evidence === null ? '' : JSON.stringify(evidence, null, 2);
  const copyEvidence = async () => {
    if (!selected || !evidenceText) return;
    try {
      await contentAuditApi.recordAccess(selected.id, 'copy', evidenceReason.trim());
      const copied = await copyToClipboard(evidenceText);
      showNotification(
        copied ? t('content_audit.copy_success') : t('content_audit.copy_error'),
        copied ? 'success' : 'error'
      );
    } catch (error) {
      showNotification(getErrorMessage(error) || t('content_audit.copy_error'), 'error');
    }
  };
  const downloadEvidence = async () => {
    if (!selected || !evidenceText) return;
    try {
      await contentAuditApi.recordAccess(selected.id, 'download', evidenceReason.trim());
      downloadBlob({
        filename: `${selected.id}-evidence.json`,
        blob: new Blob([evidenceText], { type: 'application/json' }),
      });
      showNotification(t('content_audit.download_success'), 'success');
    } catch (error) {
      showNotification(getErrorMessage(error) || t('content_audit.download_error'), 'error');
    }
  };

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div>
          <div className={styles.eyebrow}>
            <IconShield size={15} /> {t('content_audit.eyebrow')}
          </div>
          <h1>{t('content_audit.title')}</h1>
          <p>{t('content_audit.subtitle')}</p>
        </div>
        <Button variant="secondary" size="sm" onClick={loadData} loading={loading}>
          <IconRefreshCw size={15} /> {t('common.refresh')}
        </Button>
      </header>

      <section className={styles.statusStrip} aria-label={t('content_audit.status_title')}>
        <div className={styles.statusPrimary}>
          <span
            className={`${styles.statusDot} ${
              status?.ready && status.enabled
                ? status.audit_only
                  ? styles.statusObserve
                  : styles.statusOn
                : styles.statusOff
            }`}
          />
          <div>
            <strong>
              {status?.enabled
                ? status.ready
                  ? status.audit_only
                    ? t('content_audit.status_observe')
                    : t('content_audit.status_active')
                  : t('content_audit.status_error')
                : t('content_audit.status_disabled')}
            </strong>
            <span>
              {status?.error ||
                t(
                  status?.audit_only
                    ? 'content_audit.status_observe_scope'
                    : 'content_audit.status_scope'
                )}
            </span>
          </div>
        </div>
        <div className={styles.statusMetric}>
          <span>{t('content_audit.policy')}</span>
          <strong>{status?.policy_version || '-'}</strong>
        </div>
        <div className={styles.statusMetric}>
          <span>{t('content_audit.keywords')}</span>
          <strong>{status?.keyword_count?.toLocaleString() || '0'}</strong>
        </div>
        <div className={styles.statusMetric}>
          <span>{t('content_audit.current_results')}</span>
          <strong>{total.toLocaleString()}</strong>
        </div>
        <div className={styles.statusMetric}>
          <span>{t('content_audit.false_positive_page')}</span>
          <strong>{falsePositiveCount}</strong>
        </div>
        <div className={styles.statusMetric}>
          <span>{t('content_audit.encrypted_page')}</span>
          <strong>{encryptedCount}</strong>
        </div>
      </section>

      <section className={styles.filters} aria-label={t('content_audit.filters')}>
        <input
          className={styles.searchInput}
          value={draftFilters.search}
          onChange={(event) =>
            setDraftFilters((current) => ({ ...current, search: event.target.value }))
          }
          onKeyDown={(event) => event.key === 'Enter' && applyFilters()}
          placeholder={t('content_audit.search_placeholder')}
        />
        <input
          value={draftFilters.user_id}
          onChange={(event) =>
            setDraftFilters((current) => ({ ...current, user_id: event.target.value }))
          }
          placeholder={t('content_audit.user_id')}
          inputMode="numeric"
        />
        <input
          value={draftFilters.token_id}
          onChange={(event) =>
            setDraftFilters((current) => ({ ...current, token_id: event.target.value }))
          }
          placeholder={t('content_audit.token_id')}
          inputMode="numeric"
        />
        <input
          value={draftFilters.category}
          onChange={(event) =>
            setDraftFilters((current) => ({ ...current, category: event.target.value }))
          }
          placeholder={t('content_audit.category')}
        />
        <select
          value={draftFilters.severity}
          onChange={(event) =>
            setDraftFilters((current) => ({ ...current, severity: event.target.value }))
          }
          aria-label={t('content_audit.severity')}
        >
          <option value="">{t('content_audit.all_severities')}</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <select
          value={draftFilters.review_label}
          onChange={(event) =>
            setDraftFilters((current) => ({ ...current, review_label: event.target.value }))
          }
          aria-label={t('content_audit.review_label')}
        >
          <option value="">{t('content_audit.all_reviews')}</option>
          {REVIEW_LABELS.map((label) => (
            <option key={label} value={label}>
              {t(`content_audit.review.${label}`)}
            </option>
          ))}
        </select>
        <Button size="sm" onClick={applyFilters}>
          {t('content_audit.apply')}
        </Button>
        <Button size="sm" variant="ghost" onClick={resetFilters}>
          {t('content_audit.reset')}
        </Button>
      </section>

      {loadError && <div className={styles.errorBox}>{loadError}</div>}

      <section className={styles.tableShell} aria-busy={loading}>
        <div className={styles.tableHeader}>
          <div>
            <strong>{t('content_audit.hit_records')}</strong>
            <span>{t('content_audit.hit_records_hint')}</span>
          </div>
          <span>{t('content_audit.total', { count: total })}</span>
        </div>
        {events.length === 0 && !loading ? (
          <div className={styles.emptyState}>
            <IconShield size={28} />
            <strong>{t('content_audit.empty')}</strong>
            <span>{t('content_audit.empty_hint')}</span>
          </div>
        ) : (
          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th>{t('content_audit.time')}</th>
                  <th>{t('content_audit.customer')}</th>
                  <th>{t('content_audit.request')}</th>
                  <th>{t('content_audit.hit')}</th>
                  <th>{t('content_audit.review_label')}</th>
                  <th aria-label={t('common.action')} />
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr
                    key={event.id}
                    onClick={() => void openDetail(event)}
                    onKeyDown={(keyboardEvent) =>
                      keyboardEvent.key === 'Enter' && void openDetail(event)
                    }
                    tabIndex={0}
                  >
                    <td>
                      <span className={styles.primaryCell}>
                        {formatUnixTimestamp(event.created_at)}
                      </span>
                      <code>{event.id}</code>
                    </td>
                    <td>
                      <span className={styles.primaryCell}>
                        {event.token_name || t('content_audit.unnamed_token')} · #
                        {event.token_id || '-'}
                      </span>
                      <span>User #{event.user_id || '-'}</span>
                    </td>
                    <td>
                      <span className={styles.primaryCell}>{event.model || '-'}</span>
                      <code>
                        {event.method} {event.path}
                      </code>
                    </td>
                    <td>
                      <div className={styles.badgeRow}>
                        <span className={`${styles.badge} ${severityClass(event.severity)}`}>
                          {event.severity}
                        </span>
                        <span className={styles.categoryBadge}>{event.category}</span>
                      </div>
                      <code>{event.rule_id}</code>
                    </td>
                    <td>
                      <span className={`${styles.reviewBadge} ${reviewClass(event.review_label)}`}>
                        {t(`content_audit.review.${event.review_label}`)}
                      </span>
                      <span>
                        {event.evidence_status === 'encrypted'
                          ? t('content_audit.evidence_encrypted')
                          : event.evidence_status}
                      </span>
                    </td>
                    <td>
                      <IconEye size={17} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className={styles.pagination}>
          <span>{t('content_audit.page', { page, pages: pageCount })}</span>
          <div>
            <Button
              size="sm"
              variant="secondary"
              disabled={page <= 1}
              onClick={() => setPage((value) => value - 1)}
            >
              {t('content_audit.previous')}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={page >= pageCount}
              onClick={() => setPage((value) => value + 1)}
            >
              {t('content_audit.next')}
            </Button>
          </div>
        </div>
      </section>

      <Modal
        open={Boolean(selected)}
        onClose={closeDetail}
        width="min(1040px, calc(100vw - 32px))"
        title={
          <div className={styles.modalTitle}>
            <IconShield size={19} />
            <div>
              <strong>{t('content_audit.detail_title')}</strong>
              <code>{selected?.id}</code>
            </div>
          </div>
        }
      >
        {selected && (
          <div className={styles.detailLayout} aria-busy={detailLoading}>
            <section className={styles.detailSection}>
              <div className={styles.sectionHeading}>
                <div>
                  <strong>{t('content_audit.request_context')}</strong>
                  <span>{t('content_audit.request_context_hint')}</span>
                </div>
                <span className={`${styles.badge} ${severityClass(selected.severity)}`}>
                  {selected.severity}
                </span>
              </div>
              <dl className={styles.metadataGrid}>
                <div>
                  <dt>{t('content_audit.time')}</dt>
                  <dd>{formatUnixTimestamp(selected.created_at)}</dd>
                </div>
                <div>
                  <dt>Request ID</dt>
                  <dd>
                    <code>{selected.request_id || '-'}</code>
                  </dd>
                </div>
                <div>
                  <dt>{t('content_audit.customer')}</dt>
                  <dd>
                    User #{selected.user_id || '-'} / Token #{selected.token_id || '-'}
                  </dd>
                </div>
                <div>
                  <dt>{t('content_audit.token_name')}</dt>
                  <dd>{selected.token_name || '-'}</dd>
                </div>
                <div>
                  <dt>{t('content_audit.endpoint')}</dt>
                  <dd>
                    <code>
                      {selected.method} {selected.path}
                    </code>
                  </dd>
                </div>
                <div>
                  <dt>{t('common.model')}</dt>
                  <dd>{selected.model || '-'}</dd>
                </div>
                <div>
                  <dt>{t('content_audit.rule')}</dt>
                  <dd>
                    <code>{selected.rule_id}</code>
                  </dd>
                </div>
                <div>
                  <dt>{t('content_audit.upstream')}</dt>
                  <dd className={styles.stopped}>
                    <IconCheck size={14} /> {t('content_audit.not_sent')}
                  </dd>
                </div>
                <div>
                  <dt>{t('content_audit.request_size')}</dt>
                  <dd>{formatFileSize(selected.request_bytes)}</dd>
                </div>
                <div>
                  <dt>{t('content_audit.identity')}</dt>
                  <dd>
                    {selected.identity_verified
                      ? t('content_audit.verified')
                      : t('content_audit.unverified')}
                  </dd>
                </div>
              </dl>
            </section>

            <section className={styles.detailSection}>
              <div className={styles.sectionHeading}>
                <div>
                  <strong>{t('content_audit.evidence_title')}</strong>
                  <span>{t('content_audit.evidence_hint')}</span>
                </div>
                <span className={styles.lockBadge}>{t('content_audit.step_up_required')}</span>
              </div>
              {evidence === null ? (
                <div className={styles.revealForm}>
                  <label>
                    <span>{t('content_audit.reveal_reason')}</span>
                    <input
                      value={evidenceReason}
                      onChange={(event) => setEvidenceReason(event.target.value)}
                      placeholder={t('content_audit.reveal_reason_placeholder')}
                    />
                  </label>
                  <label>
                    <span>{t('content_audit.evidence_key')}</span>
                    <input
                      type="password"
                      value={evidenceKey}
                      onChange={(event) => setEvidenceKey(event.target.value)}
                      autoComplete="off"
                      placeholder={t('content_audit.evidence_key_placeholder')}
                    />
                  </label>
                  <Button onClick={revealEvidence} loading={revealLoading}>
                    <IconEye size={15} /> {t('content_audit.reveal')}
                  </Button>
                  <p>{t('content_audit.evidence_key_memory')}</p>
                </div>
              ) : (
                <div className={styles.evidencePanel}>
                  <div className={styles.evidenceActions}>
                    <span>{t('content_audit.evidence_revealed')}</span>
                    <div>
                      <Button size="sm" variant="secondary" onClick={copyEvidence}>
                        <IconFileText size={14} /> {t('common.copy')}
                      </Button>
                      <Button size="sm" variant="secondary" onClick={downloadEvidence}>
                        <IconDownload size={14} /> {t('content_audit.download')}
                      </Button>
                    </div>
                  </div>
                  <pre>{evidenceText}</pre>
                </div>
              )}
            </section>

            <section className={styles.detailSection}>
              <div className={styles.sectionHeading}>
                <div>
                  <strong>{t('content_audit.review_title')}</strong>
                  <span>{t('content_audit.review_hint')}</span>
                </div>
              </div>
              <div className={styles.reviewForm}>
                <label>
                  <span>{t('content_audit.review_label')}</span>
                  <select
                    value={reviewLabel}
                    onChange={(event) =>
                      setReviewLabel(event.target.value as ContentAuditReviewLabel)
                    }
                  >
                    {REVIEW_LABELS.map((label) => (
                      <option key={label} value={label}>
                        {t(`content_audit.review.${label}`)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>{t('content_audit.review_note')}</span>
                  <textarea
                    value={reviewNote}
                    onChange={(event) => setReviewNote(event.target.value)}
                    rows={3}
                    placeholder={t('content_audit.review_note_placeholder')}
                  />
                </label>
                <label>
                  <span>{t('content_audit.review_reason')}</span>
                  <input
                    value={reviewReason}
                    onChange={(event) => setReviewReason(event.target.value)}
                    placeholder={t('content_audit.review_reason_placeholder')}
                  />
                </label>
                <Button onClick={saveReview} loading={reviewLoading}>
                  {t('content_audit.save_review')}
                </Button>
              </div>
            </section>

            <section className={styles.detailSection}>
              <div className={styles.sectionHeading}>
                <div>
                  <strong>{t('content_audit.access_history')}</strong>
                  <span>{t('content_audit.access_history_hint')}</span>
                </div>
              </div>
              {selected.access_history?.length ? (
                <div className={styles.accessList}>
                  {selected.access_history.map((entry) => (
                    <div key={entry.id}>
                      <strong>{entry.action}</strong>
                      <span>{entry.reason}</span>
                      <code>
                        {formatUnixTimestamp(entry.created_at)} · {entry.actor || '-'}
                      </code>
                    </div>
                  ))}
                </div>
              ) : (
                <div className={styles.noAccess}>{t('content_audit.no_access_history')}</div>
              )}
            </section>
          </div>
        )}
      </Modal>
    </div>
  );
}
