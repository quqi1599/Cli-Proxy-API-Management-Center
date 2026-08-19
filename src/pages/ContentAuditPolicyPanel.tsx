import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { IconRefreshCw, IconShield } from '@/components/ui/icons';
import { useAuthStore, useNotificationStore } from '@/stores';
import {
  contentAuditApi,
  type ContentAuditPolicy,
  type ContentAuditPolicyDocument,
  type ContentAuditRule,
  type ContentAuditRuleAction,
} from '@/services/api/contentAudit';
import { formatUnixTimestamp } from '@/utils/format';
import styles from './ContentAuditPolicyPanel.module.scss';

const clonePolicy = (policy: ContentAuditPolicy): ContentAuditPolicy =>
  JSON.parse(JSON.stringify(policy)) as ContentAuditPolicy;

const lines = (value: string): string[] =>
  value
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);

const joined = (value?: string[]): string => (value || []).join('\n');

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : typeof error === 'string' ? error : '';

interface ContentAuditPolicyPanelProps {
  onPolicyChanged: () => void;
}

export function ContentAuditPolicyPanel({ onPolicyChanged }: ContentAuditPolicyPanelProps) {
  const { t } = useTranslation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const { showNotification } = useNotificationStore();
  const [document, setDocument] = useState<ContentAuditPolicyDocument | null>(null);
  const [draft, setDraft] = useState<ContentAuditPolicy | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [reason, setReason] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rollingBack, setRollingBack] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const next = await contentAuditApi.getPolicy();
      setDocument(next);
      setDraft(clonePolicy(next.policy));
      setSelectedIndex((current) => Math.min(current, Math.max(0, next.policy.rules.length - 1)));
    } catch (error) {
      showNotification(errorMessage(error) || t('content_audit.policy_load_error'), 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (connectionStatus === 'connected') void load();
    // Policy refresh is intentionally controlled by this panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionStatus]);

  const selectedRule = draft?.rules[selectedIndex] || null;
  const actionCounts = useMemo(() => {
    const rules = draft?.rules || [];
    return {
      block: rules.filter((rule) => !rule.disabled && rule.action === 'block').length,
      observe: rules.filter((rule) => !rule.disabled && rule.action === 'observe').length,
      disabled: rules.filter((rule) => rule.disabled).length,
    };
  }, [draft]);

  const updateRule = (index: number, patch: Partial<ContentAuditRule>) => {
    setDraft((current) => {
      if (!current) return current;
      const next = clonePolicy(current);
      next.rules[index] = { ...next.rules[index], ...patch };
      return next;
    });
  };

  const addRule = () => {
    if (!draft) return;
    const next = clonePolicy(draft);
    next.rules.push({
      id: `managed-rule-${next.rules.length + 1}`,
      category: 'custom',
      severity: 'high',
      action: 'observe',
      keywords: [],
      require_any: [],
      exclude_any: [],
      allowlist: [],
    });
    setDraft(next);
    setSelectedIndex(next.rules.length - 1);
  };

  const removeSelectedRule = () => {
    if (!draft || draft.rules.length <= 1) return;
    const next = clonePolicy(draft);
    next.rules.splice(selectedIndex, 1);
    setDraft(next);
    setSelectedIndex(Math.max(0, selectedIndex - 1));
  };

  const save = async () => {
    if (!draft || reason.trim().length < 4) {
      showNotification(t('content_audit.policy_reason_required'), 'warning');
      return;
    }
    setSaving(true);
    try {
      const next = await contentAuditApi.updatePolicy(draft, reason.trim());
      setDocument(next);
      setDraft(clonePolicy(next.policy));
      setReason('');
      showNotification(t('content_audit.policy_saved'), 'success');
      onPolicyChanged();
    } catch (error) {
      showNotification(errorMessage(error) || t('content_audit.policy_save_error'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const rollback = async (versionId: number) => {
    if (reason.trim().length < 4) {
      showNotification(t('content_audit.policy_reason_required'), 'warning');
      return;
    }
    setRollingBack(versionId);
    try {
      const next = await contentAuditApi.rollbackPolicy(versionId, reason.trim());
      setDocument(next);
      setDraft(clonePolicy(next.policy));
      setReason('');
      showNotification(t('content_audit.policy_rolled_back'), 'success');
      onPolicyChanged();
    } catch (error) {
      showNotification(errorMessage(error) || t('content_audit.policy_rollback_error'), 'error');
    } finally {
      setRollingBack(null);
    }
  };

  return (
    <section className={styles.panel}>
      <div className={styles.summary}>
        <div className={styles.titleGroup}>
          <span className={styles.icon}>
            <IconShield size={16} />
          </span>
          <div>
            <strong>{t('content_audit.policy_control_title')}</strong>
            <span>{t('content_audit.policy_control_hint')}</span>
          </div>
        </div>
        <div className={styles.counts}>
          <span className={styles.blockCount}>
            {t('content_audit.policy_block_count', { count: actionCounts.block })}
          </span>
          <span>{t('content_audit.policy_observe_count', { count: actionCounts.observe })}</span>
          <span>{t('content_audit.policy_disabled_count', { count: actionCounts.disabled })}</span>
        </div>
        <div className={styles.summaryActions}>
          <Button size="sm" variant="secondary" onClick={load} loading={loading}>
            <IconRefreshCw size={14} /> {t('common.refresh')}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setExpanded((value) => !value)}>
            {expanded ? t('content_audit.policy_collapse') : t('content_audit.policy_expand')}
          </Button>
        </div>
      </div>

      {expanded && draft && (
        <div className={styles.workspace}>
          <div className={styles.ruleList}>
            <div className={styles.ruleListHeader}>
              <strong>{t('content_audit.policy_rules')}</strong>
              <Button size="sm" variant="secondary" onClick={addRule}>
                {t('content_audit.policy_add_rule')}
              </Button>
            </div>
            {draft.rules.map((rule, index) => (
              <button
                type="button"
                key={`${rule.id}-${index}`}
                className={`${styles.ruleRow} ${index === selectedIndex ? styles.selected : ''}`}
                onClick={() => setSelectedIndex(index)}
              >
                <span>
                  <strong>{rule.id || t('content_audit.policy_unnamed_rule')}</strong>
                  <small>
                    {rule.category} · {rule.keywords.length} {t('content_audit.policy_terms')}
                  </small>
                </span>
                <em
                  className={
                    rule.disabled
                      ? styles.disabledAction
                      : rule.action === 'block'
                        ? styles.blockAction
                        : styles.observeAction
                  }
                >
                  {rule.disabled
                    ? t('content_audit.policy_disabled')
                    : t(`content_audit.policy_action_${rule.action}`)}
                </em>
              </button>
            ))}
          </div>

          {selectedRule && (
            <div className={styles.editor}>
              <div className={styles.editorGrid}>
                <label>
                  <span>{t('content_audit.policy_rule_id')}</span>
                  <input
                    value={selectedRule.id}
                    onChange={(event) => updateRule(selectedIndex, { id: event.target.value })}
                  />
                </label>
                <label>
                  <span>{t('content_audit.category')}</span>
                  <input
                    value={selectedRule.category}
                    onChange={(event) =>
                      updateRule(selectedIndex, { category: event.target.value })
                    }
                  />
                </label>
                <label>
                  <span>{t('content_audit.severity')}</span>
                  <select
                    value={selectedRule.severity}
                    onChange={(event) =>
                      updateRule(selectedIndex, { severity: event.target.value })
                    }
                  >
                    <option value="critical">Critical</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </label>
                <label>
                  <span>{t('content_audit.policy_action')}</span>
                  <select
                    value={selectedRule.action}
                    onChange={(event) =>
                      updateRule(selectedIndex, {
                        action: event.target.value as ContentAuditRuleAction,
                      })
                    }
                  >
                    <option value="block">{t('content_audit.policy_action_block')}</option>
                    <option value="observe">{t('content_audit.policy_action_observe')}</option>
                  </select>
                </label>
                <label className={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={Boolean(selectedRule.disabled)}
                    onChange={(event) =>
                      updateRule(selectedIndex, { disabled: event.target.checked })
                    }
                  />
                  <span>{t('content_audit.policy_disable_rule')}</span>
                </label>
              </div>

              <div className={styles.textareaGrid}>
                <label>
                  <span>{t('content_audit.policy_keywords')}</span>
                  <textarea
                    rows={10}
                    value={joined(selectedRule.keywords)}
                    onChange={(event) =>
                      updateRule(selectedIndex, { keywords: lines(event.target.value) })
                    }
                  />
                </label>
                <label>
                  <span>{t('content_audit.policy_require_any')}</span>
                  <textarea
                    rows={10}
                    value={joined(selectedRule.require_any)}
                    onChange={(event) =>
                      updateRule(selectedIndex, { require_any: lines(event.target.value) })
                    }
                  />
                </label>
                <label>
                  <span>{t('content_audit.policy_exclude_any')}</span>
                  <textarea
                    rows={10}
                    value={joined(selectedRule.exclude_any)}
                    onChange={(event) =>
                      updateRule(selectedIndex, { exclude_any: lines(event.target.value) })
                    }
                  />
                </label>
                <label>
                  <span>{t('content_audit.policy_allowlist')}</span>
                  <textarea
                    rows={10}
                    value={joined(selectedRule.allowlist)}
                    onChange={(event) =>
                      updateRule(selectedIndex, { allowlist: lines(event.target.value) })
                    }
                  />
                </label>
              </div>

              <div className={styles.globalAllowlist}>
                <label>
                  <span>{t('content_audit.policy_global_allowlist')}</span>
                  <textarea
                    rows={3}
                    value={joined(draft.global_allowlist)}
                    onChange={(event) =>
                      setDraft((current) =>
                        current
                          ? { ...current, global_allowlist: lines(event.target.value) }
                          : current
                      )
                    }
                  />
                </label>
              </div>

              <div className={styles.saveBar}>
                <input
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder={t('content_audit.policy_reason_placeholder')}
                />
                <Button variant="ghost" onClick={removeSelectedRule}>
                  {t('content_audit.policy_remove_rule')}
                </Button>
                <Button onClick={save} loading={saving}>
                  {t('content_audit.policy_save')}
                </Button>
              </div>

              <div className={styles.history}>
                <strong>{t('content_audit.policy_history')}</strong>
                {(document?.history || []).slice(0, 8).map((version) => (
                  <div key={version.id}>
                    <span>
                      <b>{version.version}</b>
                      <small>
                        {formatUnixTimestamp(version.created_at)} · {version.reason}
                      </small>
                    </span>
                    {version.active ? (
                      <em>{t('content_audit.policy_active')}</em>
                    ) : (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => void rollback(version.id)}
                        loading={rollingBack === version.id}
                      >
                        {t('content_audit.policy_rollback')}
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
