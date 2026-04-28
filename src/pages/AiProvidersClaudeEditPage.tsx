import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { useEdgeSwipeBack } from '@/hooks/useEdgeSwipeBack';
import { SecondaryScreenShell } from '@/components/common/SecondaryScreenShell';
import { useNotificationStore } from '@/stores';
import {
  ProviderGroupEditForm,
  hasProviderConnectivityAuth,
  haveProviderKeyConnectivityChanged,
  remapProviderKeyTestStatuses,
  resolveConnectivityErrorMessage,
  runProviderKeyTestBatch,
  runProviderConnectivityTest,
} from '@/components/providers';
import { parseTextList } from '@/components/providers/utils';
import type { ClaudeEditOutletContext } from './AiProvidersClaudeEditLayout';
import styles from './AiProvidersPage.module.scss';
import layoutStyles from './AiProvidersEditLayout.module.scss';

export function AiProvidersClaudeEditPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { showNotification } = useNotificationStore();
  const {
    hasIndexParam,
    invalidIndexParam,
    invalidIndex,
    disableControls,
    loading,
    saving,
    form,
    setForm,
    testModel,
    setTestModel,
    testStatus,
    setTestStatus,
    testMessage,
    setTestMessage,
    availableModels,
    handleBack,
    handleSave,
  } = useOutletContext<ClaudeEditOutletContext>();

  const title = hasIndexParam
    ? t('ai_providers.claude_edit_modal_title')
    : t('ai_providers.claude_add_modal_title');

  const swipeRef = useEdgeSwipeBack({ onBack: handleBack });
  const [isTesting, setIsTesting] = useState(false);
  const [streamEnabled, setStreamEnabled] = useState(true);
  const lastCloakConfigRef = useRef<typeof form.cloak>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        handleBack();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleBack]);

  useEffect(() => {
    if (!form.cloak) return;
    lastCloakConfigRef.current = form.cloak;
  }, [form.cloak]);

  const canSave =
    !disableControls && !loading && !saving && !invalidIndexParam && !invalidIndex && !isTesting;
  const keyList = useMemo(() => form.keyEntries.map((entry) => entry.apiKey), [form.keyEntries]);
  const duplicateKeyIndexes = useMemo(() => {
    const counts = new Map<string, number>();
    keyList.forEach((value) => {
      const trimmed = value.trim();
      if (!trimmed) return;
      counts.set(trimmed, (counts.get(trimmed) ?? 0) + 1);
    });

    return keyList.reduce<number[]>((acc, value, index) => {
      const trimmed = value.trim();
      if (trimmed && (counts.get(trimmed) ?? 0) > 1) {
        acc.push(index);
      }
      return acc;
    }, []);
  }, [keyList]);
  const hasDuplicateKeys = duplicateKeyIndexes.length > 0;

  const cloakModeOptions = useMemo(
    () => [
      { value: 'auto', label: t('ai_providers.claude_cloak_mode_auto') },
      { value: 'always', label: t('ai_providers.claude_cloak_mode_always') },
      { value: 'never', label: t('ai_providers.claude_cloak_mode_never') },
    ],
    [t]
  );

  const resolvedCloakMode = useMemo(() => {
    const mode = (form.cloak?.mode ?? '').trim().toLowerCase();
    if (!mode) return 'auto';
    if (mode === 'provider') return 'auto';
    if (mode === 'auto' || mode === 'always' || mode === 'never') return mode;
    return 'auto';
  }, [form.cloak?.mode]);

  const connectivityConfigSignature = useMemo(() => {
    const headersSignature = form.headers
      .map((entry) => `${entry.key.trim()}:${entry.value.trim()}`)
      .join('|');
    const modelsSignature = form.modelEntries
      .map((entry) => `${entry.name.trim()}:${entry.alias.trim()}`)
      .join('|');
    const keySignature = form.keyEntries
      .map((entry) => `${entry.apiKey.trim()}|${entry.proxyUrl.trim()}`)
      .join('||');
    return [
      keySignature,
      form.baseUrl?.trim() ?? '',
      testModel.trim(),
      headersSignature,
      modelsSignature,
      streamEnabled ? 'stream' : 'non-stream',
    ].join('||');
  }, [form.baseUrl, form.headers, form.keyEntries, form.modelEntries, streamEnabled, testModel]);

  const previousConnectivityConfigRef = useRef(connectivityConfigSignature);

  useEffect(() => {
    if (previousConnectivityConfigRef.current === connectivityConfigSignature) {
      return;
    }
    previousConnectivityConfigRef.current = connectivityConfigSignature;
    setTestStatus('idle');
    setTestMessage('');
  }, [connectivityConfigSignature, setTestMessage, setTestStatus]);

  const openClaudeModelDiscovery = useCallback(() => {
    navigate('models');
  }, [navigate]);

  const runSingleKeyTest = useCallback(
    async (keyIndex: number): Promise<boolean> => {
      const target = form.keyEntries[keyIndex];
      const modelName = testModel.trim() || availableModels[0] || '';
      if (!target) return false;
      if (!form.baseUrl.trim()) {
        const message = t('notification.codex_base_url_required');
        setTestStatus('error');
        setTestMessage(message);
        showNotification(message, 'error');
        return false;
      }
      if (!modelName) {
        const message = t('ai_providers.claude_test_model_required');
        setTestStatus('error');
        setTestMessage(message);
        showNotification(message, 'error');
        return false;
      }
      if (
        !hasProviderConnectivityAuth('claude', {
          headers: form.headers,
          keyHeaders: target.headers,
          apiKey: target.apiKey,
        })
      ) {
        return false;
      }

      setForm((prev) => ({
        ...prev,
        keyEntries: prev.keyEntries.map((entry, index) =>
          index === keyIndex ? { ...entry, testStatus: 'loading', testMessage: '' } : entry
        ),
      }));

      try {
        await runProviderConnectivityTest({
          provider: 'claude',
          baseUrl: form.baseUrl ?? '',
          testModel: modelName,
          headers: form.headers,
          keyHeaders: target.headers,
          apiKey: target.apiKey,
          proxyUrl: target.proxyUrl,
          stream: streamEnabled,
        });
        setForm((prev) => ({
          ...prev,
          keyEntries: prev.keyEntries.map((entry, index) =>
            index === keyIndex ? { ...entry, testStatus: 'success', testMessage: '' } : entry
          ),
        }));
        return true;
      } catch (err: unknown) {
        const resolvedMessage = resolveConnectivityErrorMessage('claude', err, t);
        setForm((prev) => ({
          ...prev,
          keyEntries: prev.keyEntries.map((entry, index) =>
            index === keyIndex
              ? { ...entry, testStatus: 'error', testMessage: resolvedMessage }
              : entry
          ),
        }));
        return false;
      }
    },
    [
      availableModels,
      form.baseUrl,
      form.headers,
      form.keyEntries,
      setForm,
      setTestMessage,
      setTestStatus,
      showNotification,
      streamEnabled,
      t,
      testModel,
    ]
  );

  const testSingleKey = useCallback(
    async (keyIndex: number): Promise<void> => {
      if (isTesting) return;
      setIsTesting(true);
      try {
        await runSingleKeyTest(keyIndex);
      } finally {
        setIsTesting(false);
      }
    },
    [isTesting, runSingleKeyTest]
  );

  const runClaudeConnectivityTest = useCallback(async () => {
    if (isTesting) return;

    const modelName = testModel.trim() || availableModels[0] || '';
    if (!modelName) {
      const message = t('ai_providers.claude_test_model_required');
      setTestStatus('error');
      setTestMessage(message);
      showNotification(message, 'error');
      return;
    }

    const validIndexes = form.keyEntries
      .map((entry, index) =>
        hasProviderConnectivityAuth('claude', {
          headers: form.headers,
          keyHeaders: entry.headers,
          apiKey: entry.apiKey,
        })
          ? index
          : -1
      )
      .filter((index) => index >= 0);

    if (!validIndexes.length) {
      const message = t('ai_providers.claude_test_key_required');
      setTestStatus('error');
      setTestMessage(message);
      showNotification(message, 'error');
      return;
    }

    setIsTesting(true);
    setTestStatus('loading');
    setTestMessage(t('ai_providers.claude_test_running'));
    setForm((prev) => ({
      ...prev,
      keyEntries: prev.keyEntries.map((entry) => ({
        ...entry,
        testStatus: hasProviderConnectivityAuth('claude', {
          headers: prev.headers,
          keyHeaders: entry.headers,
          apiKey: entry.apiKey,
        })
          ? 'loading'
          : 'idle',
        testMessage: '',
      })),
    }));

    try {
      const results = await runProviderKeyTestBatch(validIndexes, runSingleKeyTest);
      const successCount = results.filter(Boolean).length;
      const failCount = validIndexes.length - successCount;
      const message =
        failCount === 0
          ? t('ai_providers.claude_test_success')
          : successCount === 0
            ? t('ai_providers.openai_test_all_failed', { count: failCount })
            : t('ai_providers.openai_test_all_partial', {
                success: successCount,
                failed: failCount,
              });
      setTestStatus(failCount === 0 ? 'success' : 'error');
      setTestMessage(message);
      showNotification(
        message,
        failCount === 0 ? 'success' : successCount === 0 ? 'error' : 'warning'
      );
    } finally {
      setIsTesting(false);
    }
  }, [
    availableModels,
    form.headers,
    form.keyEntries,
    isTesting,
    runSingleKeyTest,
    setForm,
    setTestMessage,
    setTestStatus,
    showNotification,
    t,
    testModel,
  ]);

  return (
    <SecondaryScreenShell
      ref={swipeRef}
      contentClassName={layoutStyles.content}
      title={title}
      onBack={handleBack}
      backLabel={t('common.back')}
      backAriaLabel={t('common.back')}
      hideTopBarBackButton
      hideTopBarRightAction
      floatingAction={
        <div className={layoutStyles.floatingActions}>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleBack}
            className={layoutStyles.floatingBackButton}
          >
            {t('common.back')}
          </Button>
          <Button
            size="sm"
            onClick={() => void handleSave()}
            loading={saving}
            disabled={!canSave || hasDuplicateKeys}
            className={layoutStyles.floatingSaveButton}
          >
            {t('common.save')}
          </Button>
        </div>
      }
      isLoading={loading}
      loadingLabel={t('common.loading')}
    >
      <Card>
        {invalidIndexParam || invalidIndex ? (
          <div className={styles.sectionHint}>{t('common.invalid_provider_index')}</div>
        ) : (
          <ProviderGroupEditForm
            provider="claude"
            form={{
              ...form,
              keyEntries: form.keyEntries.map((entry, index) => ({
                ...entry,
                testStatus: duplicateKeyIndexes.includes(index) ? 'error' : entry.testStatus,
                testMessage: duplicateKeyIndexes.includes(index)
                  ? t('ai_providers.claude_duplicate_keys_detected', {
                      defaultValue: '检测到重复的 Claude API Key，请删除或修改重复项后再保存。',
                    })
                  : entry.testMessage,
              })),
            }}
            setForm={(action) => {
              const next = typeof action === 'function' ? action(form) : action;
              const connectivityChanged = haveProviderKeyConnectivityChanged(
                form.keyEntries,
                next.keyEntries
              );
              const structureChanged = form.keyEntries.length !== next.keyEntries.length;

              setForm(() => {
                if (connectivityChanged) {
                  return {
                    ...next,
                    keyEntries: next.keyEntries.map((entry) => ({
                      ...entry,
                      testStatus: 'idle',
                      testMessage: '',
                    })),
                  };
                }

                if (structureChanged) {
                  const nextStatuses = remapProviderKeyTestStatuses(
                    form.keyEntries,
                    form.keyEntries.map((entry) => ({
                      status: entry.testStatus,
                      message: entry.testMessage,
                    })),
                    next.keyEntries
                  );
                  return {
                    ...next,
                    keyEntries: next.keyEntries.map((entry, index) => ({
                      ...entry,
                      testStatus: nextStatuses[index]?.status ?? 'idle',
                      testMessage: nextStatuses[index]?.message ?? '',
                    })),
                  };
                }

                return next;
              });
              setTestModel(next.testModel ?? testModel);
              if (connectivityChanged || structureChanged) {
                setTestStatus('idle');
                setTestMessage('');
              }
            }}
            disabled={saving || disableControls}
            testing={isTesting}
            summaryStatus={testStatus}
            summaryMessage={testMessage}
            onTestAll={runClaudeConnectivityTest}
            onTestOne={testSingleKey}
            onOpenModelDiscovery={openClaudeModelDiscovery}
            streamEnabled={streamEnabled}
            onToggleStreamEnabled={(value) => {
              setStreamEnabled(value);
              setTestStatus('idle');
              setTestMessage('');
            }}
            testAllLabelKey="ai_providers.openai_test_all_action"
            testAllLabelDefault="一键测试全部密钥"
            keyEntryHighlightIndexes={duplicateKeyIndexes}
            renderBeforeKeyEntries={
              hasDuplicateKeys ? (
                <div className="status-badge warning">
                  {t('ai_providers.claude_duplicate_keys_detected', {
                    defaultValue: '检测到重复的 Claude API Key，请删除或修改重复项后再保存。',
                  })}
                </div>
              ) : null
            }
            renderAfterModels={
              <div className={styles.modelConfigSection}>
                <div className={styles.modelConfigHeader}>
                  <label className={styles.modelConfigTitle}>
                    {t('ai_providers.claude_cloak_title')}
                  </label>
                  <div className={styles.modelConfigToolbar}>
                    <ToggleSwitch
                      checked={Boolean(form.cloak)}
                      onChange={(enabled) =>
                        setForm((prev) => {
                          if (!enabled) {
                            if (prev.cloak) {
                              lastCloakConfigRef.current = prev.cloak;
                            }
                            return { ...prev, cloak: undefined };
                          }

                          const restored = prev.cloak ??
                            lastCloakConfigRef.current ?? {
                              mode: 'auto',
                              strictMode: false,
                              sensitiveWords: [],
                            };
                          const mode = String(restored.mode ?? 'auto').trim() || 'auto';
                          return {
                            ...prev,
                            cloak: {
                              mode,
                              strictMode: restored.strictMode ?? false,
                              sensitiveWords: restored.sensitiveWords ?? [],
                            },
                          };
                        })
                      }
                      disabled={saving || disableControls || isTesting}
                      ariaLabel={t('ai_providers.claude_cloak_toggle_aria')}
                      label={t('ai_providers.claude_cloak_toggle_label')}
                    />
                  </div>
                </div>
                <div className={styles.sectionHint}>{t('ai_providers.claude_cloak_hint')}</div>

                {form.cloak ? (
                  <>
                    <div className="form-group">
                      <label>{t('ai_providers.claude_cloak_mode_label')}</label>
                      <Select
                        value={resolvedCloakMode}
                        options={cloakModeOptions}
                        onChange={(value) =>
                          setForm((prev) => ({
                            ...prev,
                            cloak: {
                              ...(prev.cloak ?? {}),
                              mode: value,
                            },
                          }))
                        }
                        ariaLabel={t('ai_providers.claude_cloak_mode_label')}
                        disabled={saving || disableControls || isTesting}
                      />
                      <div className="hint">{t('ai_providers.claude_cloak_mode_hint')}</div>
                    </div>

                    <div className="form-group">
                      <label>{t('ai_providers.claude_cloak_strict_label')}</label>
                      <ToggleSwitch
                        checked={Boolean(form.cloak.strictMode)}
                        onChange={(value) =>
                          setForm((prev) => ({
                            ...prev,
                            cloak: {
                              ...(prev.cloak ?? {}),
                              strictMode: value,
                            },
                          }))
                        }
                        disabled={saving || disableControls || isTesting}
                        ariaLabel={t('ai_providers.claude_cloak_strict_label')}
                      />
                      <div className="hint">{t('ai_providers.claude_cloak_strict_hint')}</div>
                    </div>

                    <div className="form-group">
                      <label>{t('ai_providers.claude_cloak_sensitive_words_label')}</label>
                      <textarea
                        className="input"
                        placeholder={t('ai_providers.claude_cloak_sensitive_words_placeholder')}
                        value={(form.cloak.sensitiveWords ?? []).join('\n')}
                        onChange={(e) => {
                          const nextWords = parseTextList(e.target.value);
                          setForm((prev) => ({
                            ...prev,
                            cloak: {
                              ...(prev.cloak ?? {}),
                              sensitiveWords: nextWords.length ? nextWords : undefined,
                            },
                          }));
                        }}
                        rows={3}
                        disabled={saving || disableControls || isTesting}
                      />
                      <div className="hint">
                        {t('ai_providers.claude_cloak_sensitive_words_hint')}
                      </div>
                    </div>
                  </>
                ) : null}
              </div>
            }
          />
        )}
      </Card>
    </SecondaryScreenShell>
  );
}
