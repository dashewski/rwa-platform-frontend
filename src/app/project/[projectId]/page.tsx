'use client';

import React, { ChangeEventHandler, FC, FormEventHandler, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { DashboardLayout, Wrapper } from '@/components/layout';
import { Breadcrumbs, BusinessTypeSelect, CategoryCheckboxes, DocumentsSection, FaqSection } from '@/components/dashboard';
import {
  Button,
  CountrySelect,
  EMPTY_SOCIALS,
  Input,
  socialsFromArray,
  socialsToArray,
  SocialsErrors,
  SocialsInput,
  SocialsValue,
  TextArea,
  Title,
  toast,
  validateSocials,
} from '@/components/ui';
import { useMutation, useQuery, useApolloClient } from '@apollo/client/react';
import {
  EDIT_BUSINESS,
  GET_BUSINESS,
  GET_BUSINESS_DEPLOY_INFO,
  REJECT_BUSINESS_APPROVAL_SIGNATURES,
  REQUEST_BUSINESS_APPROVAL_SIGNATURES,
} from '@/lib/business/operations';
import { GET_SIGNATURE_TASK } from '@/lib/pool/operations';
import { ERC20_APPROVE_ABI, FACTORY_ABI, FACTORY_ADDRESS, HOLD_TOKEN_ADDRESS } from '@/lib/contracts';
import { GET_COMPANY } from '@/lib/company/operations';
import { NewsList } from '@/components/news';
import { CountryChip, Modal, ShareMenu, SocialLinksRow } from '@/components/common';
import { PoolsSection } from '@/components/pool';
import { BusinessType } from '@/gql/graphql';
import { useAccount, useWriteContract, useWaitForTransactionReceipt, usePublicClient } from 'wagmi';
import { useAuth } from '@/lib/auth/AuthContext';

// Fee validated against backend test: tests/rwa_fast_tests/business-deployment.test.ts uses '100'
const CREATE_RWA_FEE = '100';

type DeployStatus =
  | 'idle'
  | 'requesting-signatures'
  | 'waiting-signatures'
  | 'approving-hold'
  | 'sending-tx'
  | 'waiting-confirmation'
  | 'waiting-indexing';

const DEPLOY_STATUS_LABELS: Record<DeployStatus, string> = {
  idle: '',
  'requesting-signatures': 'Requesting approval signatures…',
  'waiting-signatures': 'Waiting for backend signatures…',
  'approving-hold': 'Approving HOLD token spend…',
  'sending-tx': 'Sending transaction…',
  'waiting-confirmation': 'Waiting for confirmation…',
  'waiting-indexing': 'Waiting for the backend to register the project…',
};

const ProjectPage: FC = () => {
  const [isEditModalOpened, setIsEditModalOpened] = useState(false);
  const [editStep, setEditStep] = useState<1 | 2>(1);
  const [nameValue, setNameValue] = useState('');
  const [aboutValue, setAboutValue] = useState('');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [countryValue, setCountryValue] = useState<string | null>(null);
  const [businessTypeValue, setBusinessTypeValue] = useState<BusinessType | null>(null);
  const [socialsValue, setSocialsValue] = useState<SocialsValue>(EMPTY_SOCIALS);
  const [socialsErrors, setSocialsErrors] = useState<SocialsErrors>({});
  const [errors, setErrors] = useState({ name: '', about: '', country: '', businessType: '' });

  const [deployStatus, setDeployStatus] = useState<DeployStatus>('idle');
  const [deployTxHash, setDeployTxHash] = useState<`0x${string}` | undefined>();
  const deployingRef = useRef(false);

  const params = useParams();
  const projectId = params.projectId as string;

  const { address: walletAddress } = useAccount();
  const { user } = useAuth();
  const apolloClient = useApolloClient();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const { data: businessData } = useQuery(GET_BUSINESS, {
    variables: { id: projectId },
    skip: !projectId,
  });

  const companyId = businessData?.getBusiness.ownerId as string;

  const { data: companyData } = useQuery(GET_COMPANY, {
    variables: { id: companyId },
    skip: !companyId,
  });

  const { data: deployInfoData, loading: deployInfoLoading, refetch: refetchDeployInfo } = useQuery(GET_BUSINESS_DEPLOY_INFO, {
    variables: { id: projectId },
    skip: !projectId,
  });

  const [editBusiness, { data: updatedBusiness, loading: updatingBusiness }] = useMutation(EDIT_BUSINESS);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [requestBusinessApprovalSignatures] = useMutation<any>(REQUEST_BUSINESS_APPROVAL_SIGNATURES);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [rejectBusinessApprovalSignatures] = useMutation<any>(REJECT_BUSINESS_APPROVAL_SIGNATURES);

  const { isSuccess: txConfirmed } = useWaitForTransactionReceipt({ hash: deployTxHash });

  const company = companyData?.getCompany;
  const project = businessData?.getBusiness;

  const canEdit = user != null && company != null && (
    company.ownerId === user.userId ||
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (company.users as any[])?.some((u: any) => u.userId === user.userId)
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const deployInfo = (deployInfoData as any)?.getBusiness;

  useEffect(() => {
    // The tx being mined isn't enough: the project counts as deployed only once the backend
    // has indexed it and exposes tokenAddress, so keep polling for it before unlocking pools.
    if (txConfirmed && deployStatus === 'waiting-confirmation') {
      setDeployStatus('waiting-indexing');
    }
  }, [txConfirmed, deployStatus]);

  useEffect(() => {
    if (deployStatus !== 'waiting-indexing') return;
    if (deployInfo?.tokenAddress) {
      setDeployStatus('idle');
      setDeployTxHash(undefined);
      deployingRef.current = false;
      toast('Project successfully deployed!');
      return;
    }
    const startedAt = Date.now();
    const id = setInterval(() => {
      if (Date.now() - startedAt > 120_000) {
        clearInterval(id);
        setDeployStatus('idle');
        setDeployTxHash(undefined);
        deployingRef.current = false;
        toast('Transaction confirmed, but the project is not registered yet. Reload the page in a minute.', 'warning');
        return;
      }
      refetchDeployInfo();
    }, 3000);
    return () => clearInterval(id);
  }, [deployStatus, deployInfo?.tokenAddress, refetchDeployInfo]);

  const pollUntilComplete = async (taskId: string, timeoutMs = 300_000) => {
    const deadline = Date.now() + timeoutMs;
    let attempt = 0;
    while (Date.now() < deadline) {
      if (attempt > 0) await new Promise(r => setTimeout(r, 3000));
      attempt++;
      try {
        const { data } = await apolloClient.query({
          query: GET_SIGNATURE_TASK,
          variables: { input: { taskId } },
          fetchPolicy: 'network-only',
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const task = (data as any)?.getSignatureTask;
        if (task?.completed) {
          return task as { signatures: { signer: string; signature: string }[]; expired: number };
        }
      } catch {
        // Network hiccup — keep polling
      }
    }
    throw new Error('Signature task timed out after 5 minutes. The backend signers may be unavailable.');
  };

  const handleDeploy = async () => {
    if (deployingRef.current) return;
    if (!walletAddress) {
      toast('Connect your wallet first', 'error');
      return;
    }
    if (!project) return;

    deployingRef.current = true;
    try {
      let taskId: string;
      const existingTaskId: string | undefined = deployInfo?.approvalSignaturesTaskId;
      const existingExpiredAt: number | undefined = deployInfo?.approvalSignaturesTaskExpired;
      const now = Math.floor(Date.now() / 1000);

      if (existingTaskId && existingExpiredAt && existingExpiredAt > now) {
        // Active non-expired task exists — reuse it directly
        taskId = existingTaskId;
      } else {
        setDeployStatus('requesting-signatures');

        // If task is expired, reject it first to clear the lock
        if (existingTaskId) {
          try {
            await rejectBusinessApprovalSignatures({ variables: { id: projectId } });
            await refetchDeployInfo();
          } catch {
            // Ignore errors — may already be cleared or rejection not yet allowed
          }
        }

        const sigRes = await requestBusinessApprovalSignatures({
          variables: {
            input: {
              id: projectId,
              ownerWallet: walletAddress,
              deployerWallet: walletAddress,
              createRWAFee: CREATE_RWA_FEE,
            },
          },
        });

        if (sigRes.error) {
          if (existingExpiredAt && existingExpiredAt + 60 > now) {
            const waitUntil = new Date((existingExpiredAt + 60) * 1000).toLocaleTimeString();
            throw new Error(`Previous signature request not yet expired. Try again after ${waitUntil}.`);
          }
          throw new Error(sigRes.error.message);
        }

        taskId = sigRes.data?.requestBusinessApprovalSignatures?.taskId;
        if (!taskId) throw new Error('No taskId returned');
      }

      setDeployStatus('waiting-signatures');
      const task = await pollUntilComplete(taskId);

      const signers = task.signatures.map((s: { signer: string }) => s.signer as `0x${string}`);
      const signatures = task.signatures.map((s: { signature: string }) => s.signature as `0x${string}`);

      const ownerId = deployInfo?.ownerId ?? project.ownerId;
      const ownerType = deployInfo?.ownerType ?? project.ownerType;

      // Approve factory to spend HOLD tokens (contract charges CREATE_RWA_FEE × 10^18)
      setDeployStatus('approving-hold');
      const approveTxHash = await writeContractAsync({
        address: HOLD_TOKEN_ADDRESS,
        abi: ERC20_APPROVE_ABI,
        functionName: 'approve',
        args: [FACTORY_ADDRESS, BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')],
      });
      if (!publicClient) throw new Error('No public client available');
      await publicClient.waitForTransactionReceipt({ hash: approveTxHash });

      setDeployStatus('sending-tx');
      const txHash = await writeContractAsync({
        address: FACTORY_ADDRESS,
        abi: FACTORY_ABI,
        functionName: 'deployRWA',
        args: [
          BigInt(CREATE_RWA_FEE),
          projectId,
          ownerId,
          ownerType,
          walletAddress,
          signers,
          signatures,
          BigInt(Math.floor(task.expired)),
        ],
        gas: BigInt(1_200_000),
      });

      setDeployTxHash(txHash);
      setDeployStatus('waiting-confirmation');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Deploy failed';
      toast(message, 'error');
      setDeployStatus('idle');
      deployingRef.current = false;
    }
  };

  const validateName = (value?: string) => (value ?? nameValue).length > 2;
  const validateAbout = (value?: string) => (value ?? aboutValue).length > 2;
  const validateCountry = (value?: string | null) => Boolean(value ?? countryValue);
  const validateBusinessType = (value?: BusinessType | null) => Boolean(value ?? businessTypeValue);

  const nameChangeHandler: ChangeEventHandler<HTMLInputElement> = evt => {
    if (validateName(evt.target.value)) setErrors(prev => ({ ...prev, name: '' }));
    setNameValue(evt.target.value);
  };

  const aboutChangeHandler: ChangeEventHandler<HTMLTextAreaElement> = evt => {
    if (validateAbout(evt.target.value)) setErrors(prev => ({ ...prev, about: '' }));
    setAboutValue(evt.target.value);
  };

  const countryChangeHandler = (code: string) => {
    if (validateCountry(code)) setErrors(prev => ({ ...prev, country: '' }));
    setCountryValue(code);
  };

  const businessTypeChangeHandler = (value: BusinessType) => {
    if (validateBusinessType(value)) setErrors(prev => ({ ...prev, businessType: '' }));
    setBusinessTypeValue(value);
  };

  const openEditModal = () => {
    setEditStep(1);
    setIsEditModalOpened(true);
  };

  const closeEditModal = () => {
    setIsEditModalOpened(false);
    setEditStep(1);
  };

  const editStep1NextHandler: FormEventHandler<HTMLFormElement> = evt => {
    evt.preventDefault();

    const currentErrors = { ...errors };
    const isNameValid = validateName();
    const isAboutValid = validateAbout();
    const isCountryValid = validateCountry();
    const isBusinessTypeValid = validateBusinessType();

    if (!isNameValid) currentErrors.name = 'Enter project name';
    if (!isAboutValid) currentErrors.about = 'Enter description';
    if (!isCountryValid) currentErrors.country = 'Select country';
    if (!isBusinessTypeValid) currentErrors.businessType = 'Select business type';

    setErrors(currentErrors);
    if (!isNameValid || !isAboutValid || !isCountryValid || !isBusinessTypeValid) return;

    setEditStep(2);
  };

  const editProjectSubmitHandler = async () => {
    const newSocialsErrors = validateSocials(socialsValue);
    setSocialsErrors(newSocialsErrors);
    if (Object.keys(newSocialsErrors).length > 0) return;

    try {
      const result = await editBusiness({
        variables: {
          input: {
            id: projectId,
            updateData: {
              name: nameValue,
              description: aboutValue,
              tags: selectedCategories,
              country: countryValue,
              businessType: businessTypeValue,
              socials: socialsToArray(socialsValue),
            },
          },
        },
      });

      if (result.error) throw result.error;

      closeEditModal();
      toast('Project successfully updated!');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update project. Please try again.';
      toast(message, 'error');
    }
  };

  useEffect(() => {
    if (!project) return;
    setNameValue(project.name);
    setAboutValue(project.description ?? '');
    setSelectedCategories(project.tags ?? []);
    setCountryValue(project.country ?? null);
    setBusinessTypeValue((project.businessType as BusinessType | undefined) ?? null);
    setSocialsValue(socialsFromArray(project.socials));
  }, [project]);

  const isDeploying = deployStatus !== 'idle';
  const isDeployed = !!deployInfo?.tokenAddress;
  // Pools can only be created on-chain for an already deployed project.
  const addPoolDisabledReason = isDeployed
    ? undefined
    : deployInfoLoading
      ? 'Checking project deployment…'
      : canEdit
        ? 'Deploy the project first to add pools.'
        : 'The project is not deployed yet.';

  return (
    <DashboardLayout>
      <section className={'mb-12'}>
        <Wrapper>
          <Breadcrumbs
            items={[
              { name: company?.name ?? '...', url: `/company/${companyId}` },
            ]}
            currentItem={updatedBusiness?.editBusiness.name ?? project?.name ?? '...'}
          />
          {project && (
            <div className={'flex flex-col gap-6 border-b-1 border-stroke-primary pb-6 lg:grid lg:grid-cols-2'}>
              <div>
                <div className={'flex items-center gap-3 mb-4'}>
                  <Title size={'xs'}>{updatedBusiness?.editBusiness.name ?? project.name}</Title>
                  <CountryChip code={updatedBusiness?.editBusiness.country ?? project.country} />
                  {isDeployed && (
                    <span
                      className={'text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700 shrink-0'}
                    >
                      Deployed
                    </span>
                  )}
                </div>
                <div className={'text-base text-black max-w-[560px] mb-4'}>
                  {updatedBusiness?.editBusiness.description ?? project.description}
                </div>
                <SocialLinksRow socials={updatedBusiness?.editBusiness.socials ?? project.socials} />
              </div>
              <div className={'flex flex-wrap gap-2 lg:items-end lg:justify-end'}>
                {!isDeployed && canEdit && (
                  <div className={'flex items-center gap-3'}>
                    <Button visualType={'quaternary'} disabled={isDeploying} onClick={handleDeploy}>
                      {isDeploying ? 'Deploying…' : 'Deploy project'}
                    </Button>
                    {isDeploying && (
                      <span className={'text-sm text-label-tertiary'}>{DEPLOY_STATUS_LABELS[deployStatus]}</span>
                    )}
                  </div>
                )}
                {canEdit && (
                  <Button
                    className={
                      'max-md:w-full before:size-3.5 before:mask-[url(/icons/edit.svg)] mask-contain before:bg-current'
                    }
                    visualType={'quinary'}
                    onClick={openEditModal}
                  >
                    Update
                  </Button>
                )}
                <ShareMenu className={'max-md:w-full'} />
              </div>
            </div>
          )}
        </Wrapper>
      </section>

      <section className={'mb-12'}>
        <Wrapper>
          <PoolsSection projectId={projectId} canAddPool={canEdit} addPoolDisabledReason={addPoolDisabledReason} />
        </Wrapper>
      </section>

      <section className={'mb-12'}>
        <Wrapper>
          <NewsList projectId={projectId} companyId={companyId} projectName={project?.name} canEdit={canEdit} />
        </Wrapper>
      </section>

      <section className={'mb-12'}>
        <Wrapper>
          <DocumentsSection projectId={projectId} companyId={companyId} canEdit={canEdit} />
        </Wrapper>
      </section>

      <section className={'mb-12'}>
        <Wrapper>
          <FaqSection projectId={projectId} canEdit={canEdit} />
        </Wrapper>
      </section>

      <Modal isOpened={isEditModalOpened} closeModal={closeEditModal}>
        <div className={'pr-14 pb-4.5 pl-4 border-b-1 border-stroke-primary mb-6'}>
          <div className={'text-base font-medium'}>Edit project</div>
          <div className={'text-xs text-text-secondary mt-0.5'}>Step {editStep} of 2</div>
        </div>

        {editStep === 1 && (
          <form onSubmit={editStep1NextHandler}>
            <div className={'px-4 mb-6'}>
              <div className={'text-sm font-medium mb-3'}>
                Project name<span className={'text-red-bright'}>*</span>
              </div>
              <Input
                placeholder={'For example, «Green Fund Series A»'}
                size={'sm'}
                colorScheme={'light'}
                errorMessage={errors.name}
                type={'text'}
                name={'projectName'}
                value={nameValue}
                onChange={nameChangeHandler}
              />
            </div>
            <div className={'px-4 mb-6'}>
              <div className={'text-sm font-medium mb-3'}>
                Description<span className={'text-red-bright'}>*</span>
              </div>
              <TextArea
                className={'h-[110px]'}
                maxLength={250}
                errorMessage={errors.about}
                placeholder={'Write a short description for your project'}
                name={'projectAbout'}
                value={aboutValue}
                onChange={aboutChangeHandler}
              />
            </div>
            <div className={'px-4 mb-6'}>
              <div className={'text-sm font-medium mb-3'}>
                Country<span className={'text-red-bright'}>*</span>
              </div>
              <CountrySelect value={countryValue} onChange={countryChangeHandler} errorMessage={errors.country} />
            </div>
            <div className={'px-4 mb-6'}>
              <BusinessTypeSelect value={businessTypeValue} onChange={businessTypeChangeHandler} />
              {errors.businessType && <div className={'pt-2 text-xs/[1] text-red-bright'}>{errors.businessType}</div>}
            </div>
            <div className={'px-4 flex justify-end'}>
              <Button visualType={'quaternary'} type={'submit'}>
                Next
              </Button>
            </div>
          </form>
        )}

        {editStep === 2 && (
          <div>
            <div className={'px-4 mb-6'}>
              <CategoryCheckboxes selected={selectedCategories} onChange={setSelectedCategories} />
            </div>
            <div className={'px-4 mb-6'}>
              <div className={'text-sm font-medium uppercase mb-3'}>Socials</div>
              <SocialsInput value={socialsValue} onChange={setSocialsValue} errors={socialsErrors} />
            </div>
            <div className={'px-4 flex justify-between'}>
              <Button visualType={'quinary'} type={'button'} onClick={() => setEditStep(1)}>
                Back
              </Button>
              <Button visualType={'quaternary'} type={'button'} disabled={updatingBusiness} onClick={editProjectSubmitHandler}>
                Apply
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </DashboardLayout>
  );
};

export default ProjectPage;
