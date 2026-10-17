'use client';

import { useParams, useRouter } from 'next/navigation';
import React, { ChangeEventHandler, FC, FormEventHandler, useEffect, useState } from 'react';
import { DashboardLayout, Wrapper } from '@/components/layout';
import { Breadcrumbs } from '@/components/dashboard';
import {
  Button,
  ButtonBorderDash,
  CountrySelect,
  EMPTY_SOCIALS,
  Icon,
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
import { useMutation, useQuery } from '@apollo/client/react';
import { GET_COMPANY, UPDATE_COMPANY, DELETE_COMPANY } from '@/lib/company/operations';
import { CREATE_BUSINESS, GET_BUSINESSES } from '@/lib/business/operations';
import { GET_POOLS } from '@/lib/pool/operations';
import { CountryChip, Modal, ShareMenu, SocialLinksRow } from '@/components/common';
import { BusinessTypeSelect, CategoryCheckboxes, TeamSection } from '@/components/dashboard';
import { ProjectCard } from '@/components/project';
import { BusinessOwnerType, BusinessType } from '@/gql/graphql';
import Link from 'next/link';
import { useAuth } from '@/lib/auth/AuthContext';

const CompanyPage: FC = () => {
  const [isEditModalOpened, setIsEditModalOpened] = useState(false);
  const [deletingCompanyStatus, setDeletingCompanyStatus] = useState<'idle' | 'approve' | 'pending'>('idle');
  const [nameValue, setNameValue] = useState('');
  const [aboutValue, setAboutValue] = useState('');
  const [countryValue, setCountryValue] = useState<string | null>(null);
  const [socialsValue, setSocialsValue] = useState<SocialsValue>(EMPTY_SOCIALS);
  const [socialsErrors, setSocialsErrors] = useState<SocialsErrors>({});
  const [errors, setErrors] = useState({ name: '', about: '', country: '' });

  const [isCreateProjectModalOpened, setIsCreateProjectModalOpened] = useState(false);
  const [projectStep, setProjectStep] = useState<1 | 2>(1);
  const [projectNameValue, setProjectNameValue] = useState('');
  const [projectAboutValue, setProjectAboutValue] = useState('');
  const [projectCountryValue, setProjectCountryValue] = useState<string | null>(null);
  const [projectBusinessType, setProjectBusinessType] = useState<BusinessType | null>(null);
  const [projectSocialsValue, setProjectSocialsValue] = useState<SocialsValue>(EMPTY_SOCIALS);
  const [projectSocialsErrors, setProjectSocialsErrors] = useState<SocialsErrors>({});
  const [projectErrors, setProjectErrors] = useState({ name: '', about: '', country: '', businessType: '' });
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);

  const params = useParams();
  const id = params.companyId as string;
  const router = useRouter();
  const { user } = useAuth();

  const {
    data: companyData,
    loading: companyDataLoading,
  } = useQuery(GET_COMPANY, {
    variables: { id },
  });

  const [updateCompany, { data: updatedCompany, loading: updatingCompany }] = useMutation(UPDATE_COMPANY);
  const [deleteCompany] = useMutation(DELETE_COMPANY);

  const { data: businessesData, refetch: refetchBusinesses } = useQuery(GET_BUSINESSES, {
    variables: { input: { filter: { ownerId: id, ownerType: BusinessOwnerType.Company } } },
    skip: !id,
  });
  
  console.log(businessesData);

  const [createBusiness, { loading: creatingBusiness }] = useMutation(CREATE_BUSINESS);

  const businessIds = businessesData?.getBusinesses.map(b => b.id) ?? [];

  type PoolItem = { id: string; businessId: string; rewardPercent?: string };

  const { data: poolsData } = useQuery<{ getPools: PoolItem[] }>(GET_POOLS, {
    variables: { input: { filter: { businessId: { $in: businessIds } } } },
    skip: businessIds.length === 0,
  });

  const poolStatsByBusiness = (poolsData?.getPools ?? []).reduce<
    Record<string, { count: number; totalReward: number; rewardCount: number }>
  >((acc, pool) => {
    const bid = pool.businessId ?? '';
    if (!acc[bid]) acc[bid] = { count: 0, totalReward: 0, rewardCount: 0 };
    acc[bid].count += 1;
    const rp = parseFloat(pool.rewardPercent ?? '');
    if (!isNaN(rp)) { acc[bid].totalReward += rp; acc[bid].rewardCount += 1; }
    return acc;
  }, {});

  const validateName = (value?: string) => (value || nameValue).length > 2;
  const validateAbout = (value?: string) => (value || aboutValue).length > 2;
  const validateCountry = (value?: string | null) => Boolean(value ?? countryValue);

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

  const formSubmitHandler: FormEventHandler<HTMLFormElement> = async evt => {
    evt.preventDefault();

    const currentErrors = { ...errors };

    const isNameValid = validateName();
    const isAboutValid = validateAbout();
    const isCountryValid = validateCountry();
    const newSocialsErrors = validateSocials(socialsValue);

    if (!isNameValid) currentErrors.name = 'Enter company name';
    if (!isAboutValid) currentErrors.about = 'Enter about';
    if (!isCountryValid) currentErrors.country = 'Select country';

    setErrors(currentErrors);
    setSocialsErrors(newSocialsErrors);

    if (!isAboutValid || !isNameValid || !isCountryValid || Object.keys(newSocialsErrors).length > 0) return;

    try {
      const result = await updateCompany({
        variables: {
          input: {
            id,
            updateData: {
              name: nameValue,
              description: aboutValue,
              country: countryValue,
              socials: socialsToArray(socialsValue),
            },
          },
        },
      });

      if (result.error) throw result.error;

      setIsEditModalOpened(false);
      toast('Company successfully updated!');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update company. Please try again.';
      toast(message, 'error');
    }
  };

  const deleteCompanyHandler = async () => {
    if (deletingCompanyStatus === 'idle') setDeletingCompanyStatus('approve');
    if (deletingCompanyStatus === 'approve') {
      setDeletingCompanyStatus('pending');

      try {
        await deleteCompany({
          variables: {
            id,
          },
        });

        toast('Company deleted.');
        setIsEditModalOpened(false);
        router.push('/my-companies/');
      } catch (err) {
        setDeletingCompanyStatus('approve');
        toast('Failed to delete company. Please try again.', 'error');
      }
    }
  };

  const validateProjectName = (value?: string) => (value ?? projectNameValue).length > 2;
  const validateProjectAbout = (value?: string) => (value ?? projectAboutValue).length > 2;
  const validateProjectCountry = (value?: string | null) => Boolean(value ?? projectCountryValue);
  const validateProjectBusinessType = (value?: BusinessType | null) => Boolean(value ?? projectBusinessType);

  const projectNameChangeHandler: ChangeEventHandler<HTMLInputElement> = evt => {
    if (validateProjectName(evt.target.value)) setProjectErrors(prev => ({ ...prev, name: '' }));
    setProjectNameValue(evt.target.value);
  };
  const projectAboutChangeHandler: ChangeEventHandler<HTMLTextAreaElement> = evt => {
    if (validateProjectAbout(evt.target.value)) setProjectErrors(prev => ({ ...prev, about: '' }));
    setProjectAboutValue(evt.target.value);
  };
  const projectCountryChangeHandler = (code: string) => {
    if (validateProjectCountry(code)) setProjectErrors(prev => ({ ...prev, country: '' }));
    setProjectCountryValue(code);
  };
  const projectBusinessTypeChangeHandler = (value: BusinessType) => {
    if (validateProjectBusinessType(value)) setProjectErrors(prev => ({ ...prev, businessType: '' }));
    setProjectBusinessType(value);
  };

  const closeCreateProjectModal = () => {
    setIsCreateProjectModalOpened(false);
    setProjectStep(1);
    setProjectNameValue('');
    setProjectAboutValue('');
    setProjectCountryValue(null);
    setProjectBusinessType(null);
    setProjectSocialsValue(EMPTY_SOCIALS);
    setProjectSocialsErrors({});
    setProjectErrors({ name: '', about: '', country: '', businessType: '' });
    setSelectedCategories([]);
  };

  const projectStep1NextHandler: FormEventHandler<HTMLFormElement> = evt => {
    evt.preventDefault();

    const currentErrors = { ...projectErrors };
    const isNameValid = validateProjectName();
    const isAboutValid = validateProjectAbout();
    const isCountryValid = validateProjectCountry();
    const isBusinessTypeValid = validateProjectBusinessType();

    if (!isNameValid) currentErrors.name = 'Enter project name';
    if (!isAboutValid) currentErrors.about = 'Enter description';
    if (!isCountryValid) currentErrors.country = 'Select country';
    if (!isBusinessTypeValid) currentErrors.businessType = 'Select business type';

    setProjectErrors(currentErrors);
    if (!isNameValid || !isAboutValid || !isCountryValid || !isBusinessTypeValid) return;

    setProjectStep(2);
  };

  const createProjectSubmitHandler = async () => {
    const newSocialsErrors = validateSocials(projectSocialsValue);
    setProjectSocialsErrors(newSocialsErrors);
    if (Object.keys(newSocialsErrors).length > 0) return;

    try {
      const result = await createBusiness({
        variables: {
          input: {
            name: projectNameValue,
            description: projectAboutValue,
            ownerId: id,
            ownerType: BusinessOwnerType.Company,
            chainId: '97',
            tags: selectedCategories,
            country: projectCountryValue,
            businessType: projectBusinessType,
            socials: socialsToArray(projectSocialsValue),
          },
        },
      });

      if (result.error) throw result.error;

      await refetchBusinesses();
      closeCreateProjectModal();
      toast('Project successfully created!');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create project. Please try again.';
      toast(message, 'error');
    }
  };

  useEffect(() => {
    if (!companyData) return;

    setNameValue(companyData.getCompany.name);
    setAboutValue(companyData.getCompany.description);
    setCountryValue(companyData.getCompany.country ?? null);
    setSocialsValue(socialsFromArray(companyData.getCompany.socials));
  }, [companyData]);

  const company = companyData?.getCompany;
  const canEdit = user != null && company != null && (
    company.ownerId === user.userId ||
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (company.users as any[])?.some((u: any) => u.userId === user.userId)
  );

  return (
    <DashboardLayout>
      <section className={'mb-12'}>
        <Wrapper>
          {companyDataLoading && 'Loading...'}
          {companyData && (
            <>
              <Breadcrumbs
                items={[]}
                currentItem={updatedCompany?.updateCompany.name || companyData.getCompany.name}
              />
              <div className={'flex flex-col gap-6 border-b-1 border-stroke-primary pb-6 lg:grid lg:grid-cols-2'}>
                <div>
                  <div className={'flex items-center gap-3 mb-4'}>
                    <Title size={'xs'}>
                      {updatedCompany?.updateCompany.name || companyData.getCompany.name}
                    </Title>
                    <CountryChip code={updatedCompany?.updateCompany.country ?? companyData.getCompany.country} />
                  </div>
                  <div className={'text-base text-black max-w-[560px] mb-4'}>
                    {updatedCompany?.updateCompany.description || companyData.getCompany.description}
                  </div>
                  <SocialLinksRow socials={updatedCompany?.updateCompany.socials ?? companyData.getCompany.socials} />
                </div>
                <div className={'flex gap-2 lg:items-end lg:justify-end'}>
                  {canEdit && (
                    <Button
                      className={
                        'max-md:w-full before:size-3.5 before:mask-[url(/icons/edit.svg)] mask-contain before:bg-current'
                      }
                      visualType={'quinary'}
                      onClick={() => setIsEditModalOpened(true)}
                    >
                      Update
                    </Button>
                  )}
                  <ShareMenu className={'max-md:w-full'} />
                </div>
              </div>
            </>
          )}
        </Wrapper>
      </section>
      <section className={'mb-12'}>
        <Wrapper>
          <div className={'flex items-center justify-between mb-6'}>
            <Title size={'xs'} level={2}>
              Projects
            </Title>
            {canEdit && businessesData?.getBusinesses && businessesData.getBusinesses.length > 0 && (
              <Button
                className={'rounded-xl'}
                visualType={'quaternary'}
                onClick={() => setIsCreateProjectModalOpened(true)}
              >
                <Icon name={'plus'} />
                Create project
              </Button>
            )}
          </div>
          <div className={'grid lg:grid-cols-2 gap-4'}>
            {businessesData?.getBusinesses.map(business => {
              const stats = poolStatsByBusiness[business.id];
              const avgReward = stats?.rewardCount
                ? (stats.totalReward / stats.rewardCount).toFixed(1)
                : null;
              return (
                <Link key={business.id} href={`/project/${business.id}`}>
                  <ProjectCard
                    project={{
                      id: business.id,
                      name: business.name,
                      description: business.description,
                      tags: business.tags,
                      riskScore: business.riskScore,
                      poolsCount: stats?.count ?? 0,
                      rewardPercent: avgReward,
                      country: business.country,
                      businessType: business.businessType,
                    }}
                  />
                </Link>
              );
            })}
            {(!businessesData?.getBusinesses || businessesData.getBusinesses.length === 0) &&
              (canEdit ? (
                <ButtonBorderDash
                  className={'min-h-[297px] max-w-110'}
                  onClick={() => setIsCreateProjectModalOpened(true)}
                >
                  Create project
                </ButtonBorderDash>
              ) : (
                <p className={'text-base text-label-tertiary'}>No projects yet.</p>
              ))}
          </div>
        </Wrapper>
      </section>

      <section className={'mb-12'}>
        <Wrapper>
          <TeamSection companyId={id} canEdit={canEdit} />
        </Wrapper>
      </section>

      <Modal isOpened={isCreateProjectModalOpened} closeModal={closeCreateProjectModal}>
        <div className={'pr-14 pb-4.5 pl-4 border-b-1 border-stroke-primary mb-6'}>
          <div className={'text-base font-medium'}>Add new project</div>
          <div className={'text-xs text-text-secondary mt-0.5'}>Step {projectStep} of 2</div>
        </div>

        {projectStep === 1 && (
          <form onSubmit={projectStep1NextHandler}>
            <div className={'px-4 mb-6'}>
              <div className={'text-sm font-medium mb-3'}>
                Project name<span className={'text-red-bright'}>*</span>
              </div>
              <Input
                placeholder={'For example, «Green Fund Series A»'}
                size={'sm'}
                colorScheme={'light'}
                errorMessage={projectErrors.name}
                type={'text'}
                name={'projectName'}
                value={projectNameValue}
                onChange={projectNameChangeHandler}
              />
            </div>
            <div className={'px-4 mb-6'}>
              <div className={'text-sm font-medium mb-3'}>
                Description<span className={'text-red-bright'}>*</span>
              </div>
              <TextArea
                className={'h-[110px]'}
                maxLength={250}
                errorMessage={projectErrors.about}
                placeholder={'Write a short description for your project'}
                name={'projectAbout'}
                value={projectAboutValue}
                onChange={projectAboutChangeHandler}
              />
            </div>
            <div className={'px-4 mb-6'}>
              <div className={'text-sm font-medium mb-3'}>
                Country<span className={'text-red-bright'}>*</span>
              </div>
              <CountrySelect
                value={projectCountryValue}
                onChange={projectCountryChangeHandler}
                errorMessage={projectErrors.country}
              />
            </div>
            <div className={'px-4 mb-6'}>
              <BusinessTypeSelect value={projectBusinessType} onChange={projectBusinessTypeChangeHandler} />
              {projectErrors.businessType && (
                <div className={'pt-2 text-xs/[1] text-red-bright'}>{projectErrors.businessType}</div>
              )}
            </div>
            <div className={'px-4 flex justify-end'}>
              <Button visualType={'quaternary'} type={'submit'}>
                Next
              </Button>
            </div>
          </form>
        )}

        {projectStep === 2 && (
          <div>
            <div className={'px-4 mb-6'}>
              <CategoryCheckboxes selected={selectedCategories} onChange={setSelectedCategories} />
            </div>
            <div className={'px-4 mb-6'}>
              <div className={'text-sm font-medium uppercase mb-3'}>Socials</div>
              <SocialsInput value={projectSocialsValue} onChange={setProjectSocialsValue} errors={projectSocialsErrors} />
            </div>
            <div className={'px-4 flex justify-between'}>
              <Button visualType={'quinary'} type={'button'} onClick={() => setProjectStep(1)}>
                Back
              </Button>
              <Button visualType={'quaternary'} type={'button'} disabled={creatingBusiness} onClick={createProjectSubmitHandler}>
                Create
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal isOpened={isEditModalOpened} closeModal={() => setIsEditModalOpened(false)}>
        <div className={'text-base font-medium pr-14 pb-4.5 pl-4 border-b-1 border-stroke-primary mb-6'}>
          Edit company
        </div>
        <form onSubmit={formSubmitHandler}>
          <div className={'px-4 mb-6'}>
            <div className={'text-sm font-medium mb-3'}>
              Company name
              <span className={'text-red-bright'}>*</span>
            </div>
            <Input
              placeholder={'For example, «GreentechCapital LLC» or «John Doe, Ltd»'}
              size={'sm'}
              colorScheme={'light'}
              errorMessage={errors.name}
              type={'text'}
              name={'companyName'}
              value={nameValue}
              onChange={nameChangeHandler}
            />
          </div>
          <div className={'px-4 mb-6'}>
            <div className={'text-sm font-medium mb-3'}>
              Country
              <span className={'text-red-bright'}>*</span>
            </div>
            <CountrySelect value={countryValue} onChange={countryChangeHandler} errorMessage={errors.country} />
          </div>
          <div className={'px-4 mb-6'}>
            <div className={'text-sm font-medium mb-3'}>
              About
              <span className={'text-red-bright'}>*</span>
            </div>
            <TextArea
              className={'h-[110px]'}
              maxLength={250}
              errorMessage={errors.about}
              placeholder={'Write a short description for your company'}
              name={'companyAbout'}
              value={aboutValue}
              onChange={aboutChangeHandler}
            />
          </div>
          <div className={'px-4 mb-6'}>
            <div className={'text-sm font-medium uppercase mb-3'}>Socials</div>
            <SocialsInput value={socialsValue} onChange={setSocialsValue} errors={socialsErrors} />
          </div>
          <div className={'px-4 flex justify-between'}>
            <Button className={'relative'} visualType={'quinary'} type={'button'} onClick={deleteCompanyHandler}>
              {deletingCompanyStatus === 'idle' && <span>Delete company</span>}
              {deletingCompanyStatus === 'approve' && (
                <>
                  <span>Yes. I'm sure</span>
                  <span className={'pointer-events-none text-start absolute w-max text-red-500 left-full ml-2 max-md:hidden'}>
                    Are your sure? <br />
                    You cannot cancel this.
                  </span>
                </>
              )}
              {deletingCompanyStatus === 'pending' && <span>Loading..</span>}
            </Button>
            <Button visualType={'quaternary'} type={'submit'} disabled={updatingCompany}>
              Apply
            </Button>
          </div>
          {deletingCompanyStatus === 'approve' && (
            <p className={'md:hidden px-4 mt-3 text-red-500'}>
              Are your sure? <br />
              You cannot cancel this.
            </p>
          )}
        </form>
      </Modal>
    </DashboardLayout>
  );
};

export default CompanyPage;
