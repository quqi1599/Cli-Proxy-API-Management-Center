import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { useEdgeSwipeBack } from '@/hooks/useEdgeSwipeBack';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { SecondaryScreenShell } from '@/components/common/SecondaryScreenShell';
import {
  findProviderGroupBySignature,
  type GroupedProviderLocationState,
  ProviderGroupEditForm,
  buildProviderGroupEditSignature,
  buildProviderConfigsFromGroupForm,
  buildProviderGroupFormState,
  buildNextProviderList,
  groupProviderConfigs,
  haveProviderKeyConnectivityChanged,
  refreshMonitorProviderMeta,
  remapProviderKeyTestStatuses,
  resolveConnectivityErrorMessage,
  runProviderKeyTestBatch,
  runProviderConnectivityTest,
} from '@/components/providers';
import { modelsApi, providersApi } from '@/services/api';
import { useAuthStore, useConfigStore, useNotificationStore } from '@/stores';
import type { ProviderKeyConfig } from '@/types';
import { buildHeaderObject } from '@/utils/headers';
import type { ModelInfo } from '@/utils/models';
import type { ProviderGroupFormState } from '@/components/providers';
import layoutStyles from './AiProvidersEditLayout.module.scss';
import styles from './AiProvidersPage.module.scss';

type LocationState = GroupedProviderLocationState & {
  copyIndex?: number;
} | null;

const buildEmptyForm = (): ProviderGroupFormState => ({
  baseUrl: '',
  prefix: '',
  priority: undefined,
  headers: [],
  modelEntries: [{ name: '', alias: '' }],
  excludedText: '',
  testModel: '',
  keyEntries: [{ apiKey: '', proxyUrl: '', headers: [], testStatus: 'idle', testMessage: '' }],
  websockets: false,
});

const parseIndexParam = (value: string | undefined) => {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
};

const getErrorMessage = (err: unknown) => {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return '';
};

export function AiProvidersCodexEditPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams<{ index?: string }>();

  const { showNotification } = useNotificationStore();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const disableControls = connectionStatus !== 'connected';

  const fetchConfig = useConfigStore((state) => state.fetchConfig);
  const updateConfigValue = useConfigStore((state) => state.updateConfigValue);
  const clearCache = useConfigStore((state) => state.clearCache);

  const [configs, setConfigs] = useState<ProviderKeyConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState<ProviderGroupFormState>(() => buildEmptyForm());
  const [baselineSignature, setBaselineSignature] = useState(() =>
    buildProviderGroupEditSignature(buildEmptyForm())
  );
  const [summaryStatus, setSummaryStatus] = useState<'idle' | 'loading' | 'success' | 'error'>(
    'idle'
  );
  const [summaryMessage, setSummaryMessage] = useState('');
  const [isTesting, setIsTesting] = useState(false);
  const [streamEnabled, setStreamEnabled] = useState(true);

  const [modelDiscoveryOpen, setModelDiscoveryOpen] = useState(false);
  const [modelDiscoveryEndpoint, setModelDiscoveryEndpoint] = useState('');
  const [discoveredModels, setDiscoveredModels] = useState<ModelInfo[]>([]);
  const [modelDiscoveryFetching, setModelDiscoveryFetching] = useState(false);
  const [modelDiscoveryError, setModelDiscoveryError] = useState('');
  const [modelDiscoverySearch, setModelDiscoverySearch] = useState('');
  const [modelDiscoverySelected, setModelDiscoverySelected] = useState<Set<string>>(new Set());
  const autoFetchSignatureRef = useRef<string>('');
  const modelDiscoveryRequestIdRef = useRef(0);

  const hasIndexParam = typeof params.index === 'string';
  const editIndex = useMemo(() => parseIndexParam(params.index), [params.index]);
  const invalidIndexParam = hasIndexParam && editIndex === null;
  const groupedConfigs = useMemo(() => groupProviderConfigs('codex', configs), [configs]);
  const requestedGroupSignature = useMemo(
    () => String((location.state as LocationState)?.groupSignature ?? '').trim(),
    [location.state]
  );
  const requestedCopySignature = useMemo(
    () => String((location.state as LocationState)?.copySignature ?? '').trim(),
    [location.state]
  );
  const initialGroup = useMemo(
    () =>
      editIndex === null
        ? undefined
        : findProviderGroupBySignature(groupedConfigs, requestedGroupSignature) ??
          groupedConfigs.find((group) => group.indexes.includes(editIndex)),
    [editIndex, groupedConfigs, requestedGroupSignature]
  );
  const invalidIndex = editIndex !== null && !initialGroup;

  const title =
    editIndex !== null
      ? t('ai_providers.codex_edit_modal_title')
      : t('ai_providers.codex_add_modal_title');

  const handleBack = useCallback(() => {
    const state = location.state as LocationState;
    if (state?.fromAiProviders) {
      navigate(-1);
      return;
    }
    navigate('/ai-providers', { replace: true });
  }, [location.state, navigate]);

  const swipeRef = useEdgeSwipeBack({ onBack: handleBack });

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
    let cancelled = false;
    setLoading(true);
    setError('');

    fetchConfig('codex-api-key')
      .then((value) => {
        if (cancelled) return;
        setConfigs(Array.isArray(value) ? (value as ProviderKeyConfig[]) : []);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : '';
        setError(message || t('notification.refresh_failed'));
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [fetchConfig, t]);

  useEffect(() => {
    if (loading) return;
    const locationState = location.state as LocationState;
    if (initialGroup) {
      const nextForm = buildProviderGroupFormState(initialGroup);
      setForm(nextForm);
      setBaselineSignature(buildProviderGroupEditSignature(nextForm));
      return;
    }
    if (editIndex === null && typeof locationState?.copyIndex === 'number') {
      const copyGroup =
        findProviderGroupBySignature(groupedConfigs, requestedCopySignature) ??
        groupedConfigs.find((group) => group.indexes.includes(locationState.copyIndex!));
      if (copyGroup) {
        const nextForm = buildProviderGroupFormState(copyGroup);
        nextForm.keyEntries = nextForm.keyEntries.map(() => ({
          apiKey: '',
          proxyUrl: '',
          headers: [],
          enabled: true,
          testStatus: 'idle' as const,
          testMessage: '',
        }));
        setForm(nextForm);
        setBaselineSignature(buildProviderGroupEditSignature(nextForm));
        return;
      }
    }
    const nextForm = buildEmptyForm();
    setForm(nextForm);
    setBaselineSignature(buildProviderGroupEditSignature(nextForm));
  }, [editIndex, groupedConfigs, initialGroup, loading, location.state]);

  const currentSignature = useMemo(() => buildProviderGroupEditSignature(form), [form]);
  const isDirty = baselineSignature !== currentSignature;
  const canGuard = !loading && !saving && !invalidIndexParam && !invalidIndex;

  const { allowNextNavigation } = useUnsavedChangesGuard({
    enabled: canGuard,
    shouldBlock: ({ currentLocation, nextLocation }) =>
      isDirty && currentLocation.pathname !== nextLocation.pathname,
    dialog: {
      title: t('common.unsaved_changes_title'),
      message: t('common.unsaved_changes_message'),
      confirmText: t('common.leave'),
      cancelText: t('common.stay'),
      variant: 'danger',
    },
  });

  useEffect(() => {
    const availableModels = form.modelEntries.map((entry) => entry.name.trim()).filter(Boolean);
    if (availableModels.length === 0) {
      if (form.testModel) {
        setForm((prev) => ({ ...prev, testModel: '' }));
      }
      return;
    }
    if (!form.testModel || !availableModels.includes(form.testModel)) {
      setForm((prev) => ({ ...prev, testModel: availableModels[0] }));
    }
  }, [form.modelEntries, form.testModel]);

  const discoveredModelsFiltered = useMemo(() => {
    const filter = modelDiscoverySearch.trim().toLowerCase();
    if (!filter) return discoveredModels;
    return discoveredModels.filter((model) => {
      const name = (model.name || '').toLowerCase();
      const alias = (model.alias || '').toLowerCase();
      const description = (model.description || '').toLowerCase();
      return name.includes(filter) || alias.includes(filter) || description.includes(filter);
    });
  }, [discoveredModels, modelDiscoverySearch]);

  const mergeDiscoveredModels = useCallback(
    (selectedModels: ModelInfo[]) => {
      if (!selectedModels.length) return;
      let addedCount = 0;
      setForm((prev) => {
        const mergedMap = new Map<string, { name: string; alias: string }>();
        prev.modelEntries.forEach((entry) => {
          const name = entry.name.trim();
          if (!name) return;
          mergedMap.set(name.toLowerCase(), { name, alias: entry.alias?.trim() || '' });
        });
        selectedModels.forEach((model) => {
          const name = String(model.name ?? '').trim();
          if (!name) return;
          const key = name.toLowerCase();
          if (mergedMap.has(key)) return;
          mergedMap.set(key, { name, alias: model.alias ?? '' });
          addedCount += 1;
        });
        const mergedEntries = Array.from(mergedMap.values());
        return {
          ...prev,
          modelEntries: mergedEntries.length ? mergedEntries : [{ name: '', alias: '' }],
        };
      });
      if (addedCount > 0) {
        showNotification(
          t('ai_providers.codex_models_fetch_added', { count: addedCount }),
          'success'
        );
      }
    },
    [showNotification, t]
  );

  const fetchCodexModelDiscovery = useCallback(async () => {
    const requestId = (modelDiscoveryRequestIdRef.current += 1);
    setModelDiscoveryFetching(true);
    setModelDiscoveryError('');
    try {
      const headerObject = buildHeaderObject(form.headers);
      const hasCustomAuthorization = Object.keys(headerObject).some(
        (key) => key.toLowerCase() === 'authorization'
      );
      const apiKey =
        form.keyEntries.find((entry) => entry.apiKey.trim())?.apiKey.trim() || undefined;
      const list = await modelsApi.fetchV1ModelsViaApiCall(
        form.baseUrl ?? '',
        hasCustomAuthorization ? undefined : apiKey,
        headerObject
      );
      if (modelDiscoveryRequestIdRef.current !== requestId) return;
      setDiscoveredModels(list);
    } catch (err: unknown) {
      if (modelDiscoveryRequestIdRef.current !== requestId) return;
      setDiscoveredModels([]);
      setModelDiscoveryError(
        `${t('ai_providers.codex_models_fetch_error')}: ${getErrorMessage(err)}`
      );
    } finally {
      if (modelDiscoveryRequestIdRef.current === requestId) {
        setModelDiscoveryFetching(false);
      }
    }
  }, [form.baseUrl, form.headers, form.keyEntries, t]);

  useEffect(() => {
    if (!modelDiscoveryOpen) {
      autoFetchSignatureRef.current = '';
      modelDiscoveryRequestIdRef.current += 1;
      setModelDiscoveryFetching(false);
      return;
    }
    const nextEndpoint = modelsApi.buildV1ModelsEndpoint(form.baseUrl ?? '');
    setModelDiscoveryEndpoint(nextEndpoint);
    setDiscoveredModels([]);
    setModelDiscoverySearch('');
    setModelDiscoverySelected(new Set());
    setModelDiscoveryError('');
    if (!nextEndpoint) return;

    const headerObject = buildHeaderObject(form.headers);
    const hasCustomAuthorization = Object.keys(headerObject).some(
      (key) => key.toLowerCase() === 'authorization'
    );
    const hasApiKeyField = form.keyEntries.some((entry) => entry.apiKey.trim());
    if (!hasApiKeyField && !hasCustomAuthorization) return;

    const headerSignature = Object.entries(headerObject)
      .sort(([a], [b]) => a.toLowerCase().localeCompare(b.toLowerCase()))
      .map(([key, value]) => `${key}:${value}`)
      .join('|');
    const firstKey = form.keyEntries.find((entry) => entry.apiKey.trim())?.apiKey.trim() || '';
    const signature = `${nextEndpoint}||${firstKey}||${headerSignature}`;
    if (autoFetchSignatureRef.current === signature) return;
    autoFetchSignatureRef.current = signature;
    void fetchCodexModelDiscovery();
  }, [fetchCodexModelDiscovery, form.baseUrl, form.headers, form.keyEntries, modelDiscoveryOpen]);

  const toggleModelDiscoverySelection = (name: string) => {
    setModelDiscoverySelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const handleApplyDiscoveredModels = () => {
    const selectedModels = discoveredModels.filter((model) =>
      modelDiscoverySelected.has(model.name)
    );
    if (selectedModels.length) {
      mergeDiscoveredModels(selectedModels);
    }
    setModelDiscoveryOpen(false);
  };

  const resetConnectivityState = useCallback(() => {
    setSummaryStatus('idle');
    setSummaryMessage('');
    setForm((prev) => ({
      ...prev,
      keyEntries: prev.keyEntries.map((entry) => ({
        ...entry,
        testStatus: 'idle',
        testMessage: '',
      })),
    }));
  }, []);

  const runSingleKeyTest = useCallback(
    async (keyIndex: number): Promise<boolean> => {
      const modelName =
        form.testModel.trim() || form.modelEntries.find((entry) => entry.name.trim())?.name || '';
      if (!form.baseUrl.trim()) {
        const message = t('notification.codex_base_url_required');
        setSummaryStatus('error');
        setSummaryMessage(message);
        showNotification(message, 'error');
        return false;
      }
      if (!modelName) {
        const message = t('notification.codex_test_model_required');
        setSummaryStatus('error');
        setSummaryMessage(message);
        showNotification(message, 'error');
        return false;
      }
      const target = form.keyEntries[keyIndex];
      if (!target?.apiKey.trim()) {
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
          provider: 'codex',
          baseUrl: form.baseUrl,
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
        const message = resolveConnectivityErrorMessage('codex', err, t);
        setForm((prev) => ({
          ...prev,
          keyEntries: prev.keyEntries.map((entry, index) =>
            index === keyIndex ? { ...entry, testStatus: 'error', testMessage: message } : entry
          ),
        }));
        return false;
      }
    },
    [
      form.baseUrl,
      form.headers,
      form.keyEntries,
      form.modelEntries,
      form.testModel,
      showNotification,
      streamEnabled,
      t,
    ]
  );

  const testOne = useCallback(
    async (keyIndex: number) => {
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

  const testAll = useCallback(async () => {
    if (isTesting) return;
    const validIndexes = form.keyEntries
      .map((entry, index) => (entry.apiKey.trim() ? index : -1))
      .filter((index) => index >= 0);
    if (!validIndexes.length) {
      const message = t('notification.codex_test_key_required');
      setSummaryStatus('error');
      setSummaryMessage(message);
      showNotification(message, 'error');
      return;
    }
    setIsTesting(true);
    setSummaryStatus('loading');
    setSummaryMessage(t('ai_providers.codex_test_running'));
    setForm((prev) => ({
      ...prev,
      keyEntries: prev.keyEntries.map((entry) => ({
        ...entry,
        testStatus: entry.apiKey.trim() ? 'loading' : 'idle',
        testMessage: '',
      })),
    }));
    try {
      const results = await runProviderKeyTestBatch(validIndexes, runSingleKeyTest);
      const successCount = results.filter(Boolean).length;
      const failCount = validIndexes.length - successCount;
      if (failCount === 0) {
        const message = t('ai_providers.codex_test_all_success', { count: successCount });
        setSummaryStatus('success');
        setSummaryMessage(message);
        showNotification(message, 'success');
      } else if (successCount === 0) {
        const message = t('ai_providers.codex_test_all_failed', { count: failCount });
        setSummaryStatus('error');
        setSummaryMessage(message);
        showNotification(message, 'error');
      } else {
        const message = t('ai_providers.codex_test_all_partial', {
          success: successCount,
          failed: failCount,
        });
        setSummaryStatus('error');
        setSummaryMessage(message);
        showNotification(message, 'warning');
      }
    } finally {
      setIsTesting(false);
    }
  }, [form.keyEntries, isTesting, runSingleKeyTest, showNotification, t]);

  const handleSave = useCallback(async () => {
    if (disableControls || saving || loading || invalidIndexParam || invalidIndex) return;
    if (!form.baseUrl.trim()) {
      showNotification(t('notification.codex_base_url_required'), 'error');
      return;
    }
    const payloads = buildProviderConfigsFromGroupForm(form);
    if (!payloads.length) {
      showNotification(t('notification.codex_test_key_required'), 'error');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const locationState = location.state as LocationState;
      const copyGroup =
        editIndex === null && typeof locationState?.copyIndex === 'number'
          ? findProviderGroupBySignature(groupedConfigs, requestedCopySignature) ??
            groupedConfigs.find((group) => group.indexes.includes(locationState.copyIndex!))
          : undefined;

      const nextList = buildNextProviderList(configs, payloads, {
        indexes: initialGroup?.indexes,
        copyIndexes: copyGroup?.indexes,
      });

      await providersApi.saveCodexConfigs(nextList);
      setConfigs(nextList);
      updateConfigValue('codex-api-key', nextList);
      clearCache('codex-api-key');
      await refreshMonitorProviderMeta();
      showNotification(
        editIndex !== null
          ? t('notification.codex_config_updated')
          : t('notification.codex_config_added'),
        'success'
      );
      allowNextNavigation();
      setBaselineSignature(buildProviderGroupEditSignature(form));
      handleBack();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '';
      setError(message);
      showNotification(`${t('notification.update_failed')}: ${message}`, 'error');
    } finally {
      setSaving(false);
    }
  }, [
    allowNextNavigation,
    clearCache,
    configs,
    disableControls,
    editIndex,
    form,
    groupedConfigs,
    handleBack,
    initialGroup,
    invalidIndex,
    invalidIndexParam,
    loading,
    location.state,
    requestedCopySignature,
    saving,
    showNotification,
    t,
    updateConfigValue,
  ]);

  const canSave =
    !disableControls && !saving && !loading && !invalidIndexParam && !invalidIndex && !isTesting;

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
            disabled={!canSave}
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
        {error && <div className="error-box">{error}</div>}
        {invalidIndexParam || invalidIndex ? (
          <div className="hint">{t('common.invalid_provider_index')}</div>
        ) : (
          <>
            <ProviderGroupEditForm
              provider="codex"
              form={form}
              setForm={(updater) => {
                setForm((prev) => {
                  const next = updater(prev);
                  const connectivityChanged = haveProviderKeyConnectivityChanged(
                    prev.keyEntries,
                    next.keyEntries
                  );
                  const structureChanged = prev.keyEntries.length !== next.keyEntries.length;

                  if (connectivityChanged) {
                    setSummaryStatus('idle');
                    setSummaryMessage('');
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
                    setSummaryStatus('idle');
                    setSummaryMessage('');
                    const nextStatuses = remapProviderKeyTestStatuses(
                      prev.keyEntries,
                      prev.keyEntries.map((entry) => ({
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
              }}
              disabled={disableControls || saving}
              testing={isTesting}
              summaryStatus={summaryStatus}
              summaryMessage={summaryMessage}
              onTestAll={testAll}
              onTestOne={testOne}
              onOpenModelDiscovery={() => setModelDiscoveryOpen(true)}
              streamEnabled={streamEnabled}
              onToggleStreamEnabled={(value) => {
                setStreamEnabled(value);
                resetConnectivityState();
              }}
              renderExtraFields={
                <div className="form-group">
                  <label>{t('ai_providers.codex_websockets_label')}</label>
                  <ToggleSwitch
                    checked={Boolean(form.websockets)}
                    onChange={(value) => {
                      setForm((prev) => ({ ...prev, websockets: value }));
                      resetConnectivityState();
                    }}
                    disabled={disableControls || saving || isTesting}
                    ariaLabel={t('ai_providers.codex_websockets_label')}
                  />
                  <div className="hint">{t('ai_providers.codex_websockets_hint')}</div>
                </div>
              }
            />

            <Modal
              open={modelDiscoveryOpen}
              title={t('ai_providers.codex_models_fetch_title')}
              onClose={() => setModelDiscoveryOpen(false)}
              width={720}
              footer={
                <>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setModelDiscoveryOpen(false)}
                    disabled={modelDiscoveryFetching}
                  >
                    {t('common.cancel')}
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleApplyDiscoveredModels}
                    disabled={disableControls || saving || modelDiscoveryFetching}
                  >
                    {t('ai_providers.codex_models_fetch_apply')}
                  </Button>
                </>
              }
            >
              <div className={styles.openaiModelsContent}>
                <div className={styles.sectionHint}>
                  {t('ai_providers.codex_models_fetch_hint')}
                </div>
                <div className={styles.openaiModelsEndpointSection}>
                  <label className={styles.openaiModelsEndpointLabel}>
                    {t('ai_providers.codex_models_fetch_url_label')}
                  </label>
                  <div className={styles.openaiModelsEndpointControls}>
                    <input
                      className={`input ${styles.openaiModelsEndpointInput}`}
                      readOnly
                      value={modelDiscoveryEndpoint}
                    />
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void fetchCodexModelDiscovery()}
                      loading={modelDiscoveryFetching}
                      disabled={disableControls || saving}
                    >
                      {t('ai_providers.codex_models_fetch_refresh')}
                    </Button>
                  </div>
                </div>
                <Input
                  label={t('ai_providers.codex_models_search_label')}
                  placeholder={t('ai_providers.codex_models_search_placeholder')}
                  value={modelDiscoverySearch}
                  onChange={(event) => setModelDiscoverySearch(event.target.value)}
                  disabled={modelDiscoveryFetching}
                />
                {modelDiscoveryError && <div className="error-box">{modelDiscoveryError}</div>}
                {modelDiscoveryFetching ? (
                  <div className={styles.sectionHint}>
                    {t('ai_providers.codex_models_fetch_loading')}
                  </div>
                ) : discoveredModels.length === 0 ? (
                  <div className={styles.sectionHint}>
                    {t('ai_providers.codex_models_fetch_empty')}
                  </div>
                ) : discoveredModelsFiltered.length === 0 ? (
                  <div className={styles.sectionHint}>
                    {t('ai_providers.codex_models_search_empty')}
                  </div>
                ) : (
                  <div className={styles.modelDiscoveryList}>
                    {discoveredModelsFiltered.map((model) => {
                      const checked = modelDiscoverySelected.has(model.name);
                      return (
                        <label
                          key={model.name}
                          className={`${styles.modelDiscoveryRow} ${
                            checked ? styles.modelDiscoveryRowSelected : ''
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleModelDiscoverySelection(model.name)}
                          />
                          <div className={styles.modelDiscoveryMeta}>
                            <div className={styles.modelDiscoveryName}>
                              {model.name}
                              {model.alias ? (
                                <span className={styles.modelDiscoveryAlias}>{model.alias}</span>
                              ) : null}
                            </div>
                            {model.description ? (
                              <div className={styles.modelDiscoveryDesc}>{model.description}</div>
                            ) : null}
                          </div>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            </Modal>
          </>
        )}
      </Card>
    </SecondaryScreenShell>
  );
}
