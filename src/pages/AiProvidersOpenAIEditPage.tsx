import { useEffect, useCallback, useMemo, useRef, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { SecondaryScreenShell } from '@/components/common/SecondaryScreenShell';
import { useEdgeSwipeBack } from '@/hooks/useEdgeSwipeBack';
import { useNotificationStore } from '@/stores';
import {
  ProviderGroupEditForm,
  buildLegacyOpenAIFormState,
  hasProviderConnectivityAuth,
  haveProviderKeyConnectivityChanged,
  remapProviderKeyTestStatuses,
  resolveConnectivityErrorMessage,
  runProviderKeyTestBatch,
  runProviderConnectivityTest,
} from '@/components/providers';
import type { ProviderGroupFormState } from '@/components/providers';
import { headersToEntries } from '@/utils/headers';
import type { OpenAIEditOutletContext } from './AiProvidersOpenAIEditLayout';
import styles from './AiProvidersPage.module.scss';
import layoutStyles from './AiProvidersEditLayout.module.scss';

export function AiProvidersOpenAIEditPage() {
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
    keyTestStatuses,
    setDraftKeyTestStatus,
    setDraftKeyTestStatuses,
    resetDraftKeyTestStatuses,
    availableModels,
    handleBack,
    handleSave,
  } = useOutletContext<OpenAIEditOutletContext>();

  const title = hasIndexParam
    ? t('ai_providers.openai_edit_modal_title')
    : t('ai_providers.openai_add_modal_title');

  const swipeRef = useEdgeSwipeBack({ onBack: handleBack });
  const [isTestingKeys, setIsTestingKeys] = useState(false);
  const [streamEnabled, setStreamEnabled] = useState(true);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        handleBack();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleBack]);

  const canSave =
    !disableControls &&
    !loading &&
    !saving &&
    !invalidIndexParam &&
    !invalidIndex &&
    !isTestingKeys;

  const connectivityConfigSignature = useMemo(() => {
    const headersSignature = form.headers
      .map((entry) => `${entry.key.trim()}:${entry.value.trim()}`)
      .join('|');
    const modelsSignature = form.modelEntries
      .map((entry) => `${entry.name.trim()}:${entry.alias.trim()}`)
      .join('|');
    return [
      form.baseUrl.trim(),
      testModel.trim(),
      headersSignature,
      modelsSignature,
      streamEnabled ? 'stream' : 'non-stream',
    ].join('||');
  }, [form.baseUrl, form.headers, form.modelEntries, streamEnabled, testModel]);
  const previousConnectivityConfigRef = useRef(connectivityConfigSignature);

  useEffect(() => {
    if (previousConnectivityConfigRef.current === connectivityConfigSignature) {
      return;
    }
    previousConnectivityConfigRef.current = connectivityConfigSignature;
    resetDraftKeyTestStatuses(form.apiKeyEntries.length);
    setTestStatus('idle');
    setTestMessage('');
  }, [
    connectivityConfigSignature,
    form.apiKeyEntries.length,
    resetDraftKeyTestStatuses,
    setTestStatus,
    setTestMessage,
  ]);

  const runSingleKeyTest = useCallback(
    async (keyIndex: number): Promise<boolean> => {
      const baseUrl = form.baseUrl.trim();
      if (!baseUrl) {
        showNotification(t('notification.openai_test_url_required'), 'error');
        return false;
      }

      const keyEntry = form.apiKeyEntries[keyIndex];
      if (
        !hasProviderConnectivityAuth('openai', {
          headers: form.headers,
          keyHeaders: keyEntry?.headers,
          apiKey: keyEntry?.apiKey,
        })
      ) {
        setDraftKeyTestStatus(keyIndex, {
          status: 'error',
          message: t('notification.openai_test_key_required'),
        });
        return false;
      }

      const modelName = testModel.trim() || availableModels[0] || '';
      if (!modelName) {
        showNotification(t('notification.openai_test_model_required'), 'error');
        return false;
      }

      setDraftKeyTestStatus(keyIndex, { status: 'loading', message: '' });

      try {
        await runProviderConnectivityTest({
          provider: 'openai',
          baseUrl,
          testModel: modelName,
          headers: form.headers,
          keyHeaders: keyEntry?.headers,
          apiKey: keyEntry?.apiKey ?? '',
          proxyUrl: keyEntry?.proxyUrl,
          stream: streamEnabled,
        });

        setDraftKeyTestStatus(keyIndex, { status: 'success', message: '' });
        return true;
      } catch (err: unknown) {
        const errorMessage = resolveConnectivityErrorMessage('openai', err, t);
        setDraftKeyTestStatus(keyIndex, { status: 'error', message: errorMessage });
        return false;
      }
    },
    [
      form.apiKeyEntries,
      form.baseUrl,
      form.headers,
      testModel,
      availableModels,
      streamEnabled,
      t,
      setDraftKeyTestStatus,
      showNotification,
    ]
  );

  const testSingleKey = useCallback(
    async (keyIndex: number): Promise<void> => {
      if (isTestingKeys) return;
      setIsTestingKeys(true);
      try {
        await runSingleKeyTest(keyIndex);
      } finally {
        setIsTestingKeys(false);
      }
    },
    [isTestingKeys, runSingleKeyTest]
  );

  const testAllKeys = useCallback(async () => {
    if (isTestingKeys) return;

    const baseUrl = form.baseUrl.trim();
    if (!baseUrl) {
      const message = t('notification.openai_test_url_required');
      setTestStatus('error');
      setTestMessage(message);
      showNotification(message, 'error');
      return;
    }

    const modelName = testModel.trim() || availableModels[0] || '';
    if (!modelName) {
      const message = t('notification.openai_test_model_required');
      setTestStatus('error');
      setTestMessage(message);
      showNotification(message, 'error');
      return;
    }

    const validKeyIndexes = form.apiKeyEntries
      .map((entry, index) =>
        hasProviderConnectivityAuth('openai', {
          headers: form.headers,
          keyHeaders: entry.headers,
          apiKey: entry.apiKey,
        })
          ? index
          : -1
      )
      .filter((index) => index >= 0);
    if (validKeyIndexes.length === 0) {
      const message = t('notification.openai_test_key_required');
      setTestStatus('error');
      setTestMessage(message);
      showNotification(message, 'error');
      return;
    }

    setIsTestingKeys(true);
    setTestStatus('loading');
    setTestMessage(t('ai_providers.openai_test_running'));
    resetDraftKeyTestStatuses(form.apiKeyEntries.length);

    try {
      const results = await runProviderKeyTestBatch(validKeyIndexes, runSingleKeyTest);

      const successCount = results.filter(Boolean).length;
      const failCount = validKeyIndexes.length - successCount;

      if (failCount === 0) {
        const message = t('ai_providers.openai_test_all_success', { count: successCount });
        setTestStatus('success');
        setTestMessage(message);
        showNotification(message, 'success');
      } else if (successCount === 0) {
        const message = t('ai_providers.openai_test_all_failed', { count: failCount });
        setTestStatus('error');
        setTestMessage(message);
        showNotification(message, 'error');
      } else {
        const message = t('ai_providers.openai_test_all_partial', {
          success: successCount,
          failed: failCount,
        });
        setTestStatus('error');
        setTestMessage(message);
        showNotification(message, 'warning');
      }
    } finally {
      setIsTestingKeys(false);
    }
  }, [
    isTestingKeys,
    form.baseUrl,
    form.apiKeyEntries,
    form.headers,
    testModel,
    availableModels,
    t,
    setTestStatus,
    setTestMessage,
    resetDraftKeyTestStatuses,
    runSingleKeyTest,
    showNotification,
  ]);

  const openOpenaiModelDiscovery = useCallback(() => {
    const baseUrl = form.baseUrl.trim();
    if (!baseUrl) {
      showNotification(t('ai_providers.openai_models_fetch_invalid_url'), 'error');
      return;
    }
    navigate('models');
  }, [form.baseUrl, navigate, showNotification, t]);

  const sharedForm = useMemo<ProviderGroupFormState>(
    () => ({
      name: form.name,
      priority: form.priority,
      prefix: form.prefix ?? '',
      baseUrl: form.baseUrl,
      headers: form.headers,
      excludedText: form.excludedText,
      testModel,
      modelEntries: form.modelEntries,
      keyEntries: (form.apiKeyEntries.length
        ? form.apiKeyEntries
        : [{ apiKey: '', proxyUrl: '', headers: undefined }]
      ).map((entry, index) => ({
        apiKey: String(entry.apiKey ?? ''),
        proxyUrl: String(entry.proxyUrl ?? ''),
        headers: headersToEntries(entry.headers),
        enabled: !entry.disabled,
        testStatus: keyTestStatuses[index]?.status ?? 'idle',
        testMessage: keyTestStatuses[index]?.message ?? '',
      })),
    }),
    [form, keyTestStatuses, testModel]
  );

  const setSharedForm = useCallback(
    (action: (prev: ProviderGroupFormState) => ProviderGroupFormState) => {
      const nextSharedForm = action(sharedForm);
      const previousEntries = sharedForm.keyEntries;
      const nextEntries = nextSharedForm.keyEntries;
      const nextForm = buildLegacyOpenAIFormState(nextSharedForm);
      const connectivityChanged = haveProviderKeyConnectivityChanged(previousEntries, nextEntries);
      const structureChanged = previousEntries.length !== nextEntries.length;

      setForm(nextForm);
      setTestModel(nextSharedForm.testModel);

      if (connectivityChanged) {
        resetDraftKeyTestStatuses(nextEntries.length);
        setTestStatus('idle');
        setTestMessage('');
        return;
      }

      const visibleStatuses = previousEntries.map((entry) => ({
        status: entry.testStatus,
        message: entry.testMessage,
      }));
      setDraftKeyTestStatuses(
        remapProviderKeyTestStatuses(previousEntries, visibleStatuses, nextEntries)
      );

      if (structureChanged) {
        setTestStatus('idle');
        setTestMessage('');
      }
    },
    [
      resetDraftKeyTestStatuses,
      setDraftKeyTestStatuses,
      setForm,
      setTestMessage,
      setTestModel,
      setTestStatus,
      sharedForm,
    ]
  );

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
        {invalidIndexParam || invalidIndex ? (
          <div className={styles.sectionHint}>{t('common.invalid_provider_index')}</div>
        ) : (
          <ProviderGroupEditForm
            provider="openai"
            form={sharedForm}
            setForm={setSharedForm}
            disabled={saving || disableControls}
            testing={isTestingKeys}
            summaryStatus={testStatus}
            summaryMessage={testMessage}
            onTestAll={testAllKeys}
            onTestOne={testSingleKey}
            onOpenModelDiscovery={openOpenaiModelDiscovery}
            streamEnabled={streamEnabled}
            onToggleStreamEnabled={(value) => {
              setStreamEnabled(value);
              resetDraftKeyTestStatuses(form.apiKeyEntries.length);
              setTestStatus('idle');
              setTestMessage('');
            }}
            showNameField
          />
        )}
      </Card>
    </SecondaryScreenShell>
  );
}
