'use client';

import React, { FC } from 'react';
import clsx from 'clsx';
import { useQuery } from '@apollo/client/react';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { useAccount } from 'wagmi';

import { AppDemo, Hero, HowItWorks, HowToStart, PoolProgress } from '@/components/home';
import { FAQ, Gallery } from '@/components/common';
import { CommonLayout, Wrapper } from '@/components/layout';
import { Button, Card, Title } from '@/components/ui';
import { MarketplaceCard, type MarketplaceProject } from '@/components/marketplace';
import { GET_POOLS } from '@/lib/pool/operations';
import { getCollectedHold } from '@/lib/pool/collected';
import { getPoolPrice, formatPoolDate } from '@/lib/pool/display';
import { getPoolStatus } from '@/lib/pool/status';
import { formatTicker } from '@/lib/formatTicker';
import Link from 'next/link';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPool = any;

function parseWeiToNum(raw: string | null | undefined): number {
  if (!raw) return 0;
  try {
    return Number(BigInt(raw) / BigInt(10) ** BigInt(15)) / 1000;
  } catch {
    return 0;
  }
}

function getMonthlyProfit(rewardPercent: number | null | undefined): string {
  if (rewardPercent == null) return '0';
  const pct = rewardPercent > 100 ? rewardPercent / 100 : rewardPercent;
  return pct % 1 === 0 ? String(pct) : pct.toFixed(1);
}

function poolToProject(pool: AnyPool): MarketplaceProject {
  const price = `${getPoolPrice(pool)} USDT`;
  return {
    id: pool.id,
    name: pool.name,
    tokenTicker: formatTicker(pool.name),
    logoUrl: pool.imageUrl ?? undefined,
    price,
    priceNum: parseFloat(price) || 0,
    monthlyProfit: getMonthlyProfit(pool.rewardPercent),
    collected: parseWeiToNum(getCollectedHold(pool)),
    total: parseWeiToNum(pool.expectedHoldAmount),
    dueDate: formatPoolDate(pool.completionPeriodExpired ?? pool.entryPeriodExpired),
    closesDate: formatPoolDate(pool.entryPeriodExpired),
    status: getPoolStatus(pool),
    startsOn: pool.entryPeriodStart && Date.now() / 1000 < pool.entryPeriodStart ? formatPoolDate(pool.entryPeriodStart) : undefined,
    createdAt: pool.createdAt ?? 0,
    riskScore: pool.riskScore ?? 0,
  };
}

const Home: FC = () => {
  const { openConnectModal } = useConnectModal();
  const { address } = useAccount();
  const { data } = useQuery(GET_POOLS, {
    variables: { input: { filter: {} } },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const deployedPools: MarketplaceProject[] = ((data as any)?.getPools ?? [])
    .filter((p: AnyPool) => p.poolAddress)
    .map(poolToProject);

  const sectionOnePools = deployedPools.slice(0, 9);
  const sectionTwoPools = deployedPools.slice(0, 4);

  return (
    <CommonLayout>
      <Hero />
      <HowItWorks />
      <section className={'mb-25 md:mb-50'}>
        <Wrapper>
          <div className={'text-center mb-10 md:mb-20'}>
            <Title className={'mb-3 md:mb-6'} size={'lg'} level={2}>
              Choose from hundreds <br />
              of&nbsp;promising projects
            </Title>
            <p className={'text-grey-dark text-base/[1.4]'}>Find assets that meet your goals</p>
          </div>
          <div className={'grid gap-3 mb-6 md:mb-5 md:gap-5 sm:grid-cols-2 lg:grid-cols-3'}>
            {sectionOnePools.map((project, index) => (
              <MarketplaceCard className={clsx(index > 3 && 'max-md:hidden')} project={project} key={project.id} />
            ))}
          </div>
          <Button className={'w-full'} visualType={'secondary'} href={'/marketplace'}>
            See more projects
          </Button>
        </Wrapper>
      </section>
      <Gallery
        id={'detailed-info'}
        title={'See detailed info about the token \non the project page'}
        images={[
          '/images/gallery-mock.png',
          '/images/gallery-mock.png',
          '/images/gallery-mock.png',
          '/images/gallery-mock.png',
          '/images/gallery-mock.png',
          '/images/gallery-mock.png',
          '/images/gallery-mock.png',
        ]}
      />
      <PoolProgress />
      <section className={'mb-25 md:mb-50'}>
        <Wrapper>
          <Title className={'mb-10 md:mb-20'} size={'lg'} level={2}>
            Four tools for high level of reliability
          </Title>
          <div className={'grid gap-3 lg:grid-cols-2'}>
            <Card
              className={'flex flex-col text-white bg-[url(/images/bg-card-glow.png)] bg-cover lg:row-span-2'}
              size={'xl'}
              color={'blueDim'}
            >
              <Title
                className={
                  'flex items-center gap-4 mb-3 before:size-8 before:bg-white before:mask-[url(/icons/sparkles.svg)] before:mask-contain md:mb-3'
                }
                size={'md'}
                level={4}
              >
                Transparent risk level
              </Title>
              <p className={'text-base/[1.4] font-medium mb-4 lg:mb-auto'}>
                AI assigns a personal risk level to each project based on:
              </p>
              <div className={'grid gap-3 md:gap-8'}>
                <Card
                  className={
                    'flex gap-3 bg-white/16 before:shrink-0 before:size-6 before:bg-white before:mask-[url(/icons/star.svg)] before:mask-contain lg:max-w-[460px]'
                  }
                  size={'xs'}
                  color={'white'}
                >
                  <p>
                    <strong>Business Plan</strong> — documentation, roadmap, investment presentation and project summary
                  </p>
                </Card>
                <Card
                  className={
                    'flex gap-3 bg-white/16 before:shrink-0 before:size-6 before:bg-white before:mask-[url(/icons/star.svg)] before:mask-contain lg:max-w-[460px] lg:ml-auto'
                  }
                  size={'xs'}
                  color={'white'}
                >
                  <p>
                    <strong>Financial Model</strong> — pool structure and economic viability evaluation
                  </p>
                </Card>
                <Card
                  className={
                    'flex gap-3 bg-white/16 before:shrink-0 before:size-6 before:bg-white before:mask-[url(/icons/star.svg)] before:mask-contain lg:max-w-[460px]'
                  }
                  size={'xs'}
                  color={'white'}
                >
                  <p>
                    <strong>Project owner reliability</strong> — project owner's score based on previous projects
                  </p>
                </Card>
              </div>
            </Card>
            <Card size={'xl'} color={'greyLight'}>
              <Title className={'mb-5 md:mb-8'} size={'md'} level={4}>
                Decentralized platform
              </Title>
              <p className={'text-grey-dark text-base/[1.4] mb-4 md:mb-6'}>
                Slices, as a DEX platform, is secure from common crypto-investing risks:
              </p>
              <ul className={'overflow-hidden flex flex-col gap-3'}>
                <li
                  className={
                    'flex gap-3 text-grey-dark text-base/[1.4] before:shrink-0 before:size-5 before:bg-blue before:mask-[url(/icons/star.svg)] before:mask-contain'
                  }
                >
                  Independent of third-party interests
                </li>
                <li
                  className={
                    'flex gap-3 whitespace-pre-wrap text-grey-dark text-base/[1.4] before:shrink-0 before:size-5 before:bg-blue before:mask-[url(/icons/star.svg)] before:mask-contain'
                  }
                >
                  Low risk of hacking
                </li>
                <li
                  className={
                    'flex gap-3 whitespace-pre-wrap text-grey-dark text-base/[1.4] before:shrink-0 before:size-5 before:bg-blue before:mask-[url(/icons/star.svg)] before:mask-contain'
                  }
                >
                  Only you have access to your private key
                </li>
              </ul>
            </Card>
            <Card size={'xl'} color={'greyLight'}>
              <Title className={'mb-5 md:mb-8'} size={'md'} level={4}>
                Money-guarding system
              </Title>
              <p className={'text-grey-dark text-base/[1.4] mb-4 md:mb-6'}>
                We transfer money to project owners only when all DAO-holders agree:
              </p>
              <ul className={'overflow-hidden flex flex-col gap-3'}>
                <li
                  className={
                    'flex gap-3 text-grey-dark text-base/[1.4] before:shrink-0 before:size-5 before:bg-blue before:mask-[url(/icons/star.svg)] before:mask-contain'
                  }
                >
                  Voting for every tranche
                </li>
                <li
                  className={
                    'flex gap-3 whitespace-pre-wrap text-grey-dark text-base/[1.4] before:shrink-0 before:size-5 before:bg-blue before:mask-[url(/icons/star.svg)] before:mask-contain'
                  }
                >
                  Regular monitoring of project obligation compliance
                </li>
                <li
                  className={
                    'flex gap-3 whitespace-pre-wrap text-grey-dark text-base/[1.4] before:shrink-0 before:size-5 before:bg-blue before:mask-[url(/icons/star.svg)] before:mask-contain'
                  }
                >
                  Refund in case of pool failure
                </li>
              </ul>
            </Card>
            <Card className={'lg:col-span-2'} size={'xl'} color={'greyLight'}>
              <Title className={'mb-5 md:mb-8'} size={'md'} level={4}>
                Verification system for every incoming business
              </Title>
              <div className={'grid gap-3 md:gap-5 lg:grid-cols-3'}>
                <Card
                  className={
                    'flex items-center gap-4 text-xl/[1.2] tracking-tight font-semibold ' +
                    'before:shrink-0 before:size-8 before:bg-blue-gradient before:mask-[url(/icons/proven.svg)] before:mask-contain'
                  }
                  size={'xxs'}
                  color={'blueDim'}
                >
                  KYC verification
                </Card>
                <Card
                  className={
                    'flex items-center gap-4 text-xl/[1.2] tracking-tight font-medium md:font-semibold ' +
                    'before:shrink-0 before:size-8 before:bg-blue-gradient before:mask-[url(/icons/proven.svg)] before:mask-contain'
                  }
                  size={'xxs'}
                  color={'blueDim'}
                >
                  AML compliance check
                </Card>
                <Card
                  className={
                    'flex items-center gap-4 text-xl/[1.2] tracking-tight font-semibold ' +
                    'before:shrink-0 before:size-8 before:bg-blue-gradient before:mask-[url(/icons/proven.svg)] before:mask-contain'
                  }
                  size={'xxs'}
                  color={'blueDim'}
                >
                  100 USDT admission fee
                </Card>
              </div>
            </Card>
          </div>
        </Wrapper>
      </section>
      <section className={'mb-25 md:mb-50'}>
        <Wrapper>
          <Title className={'text-center mb-10 md:mb-20'} size={'lg'} level={2}>
            Ready to earn more? <br />
            Trade your assets
          </Title>
          <div className={'grid gap-3 mb-10 md:mb-15 md:grid-cols-2 md:gap-5'}>
            <Card size={'xl'} color={'white'}>
              <div className={'size-9 bg-blue-gradient mask-[url(/icons/rocket.svg)] mask-contain mb-10'} />
              <Title className={'mb-3'} size={'md'} level={4}>
                For early buyers
              </Title>
              <p className={'text-grey-dark text-base[1.4] font-medium'}>
                Sell your tokens to late buyers at a profit up to 300% without waiting for payments
              </p>
            </Card>
            <Card size={'xl'} color={'greyLight'}>
              <div className={'size-9 bg-blue-gradient mask-[url(/icons/finish.svg)] mask-contain mb-10'} />
              <Title className={'mb-3'} size={'md'} level={4}>
                For late buyers
              </Title>
              <p className={'text-grey-dark text-base[1.4] font-medium'}>
                Buy project tokens even after the fundraising has ended and get payments in the future
              </p>
            </Card>
          </div>
          <Title className={'text-center mb-7 md:mb-10 lg:text-start'} size={'sm'}>
            Join most active projects
          </Title>
          <div className={'grid gap-3 mb-6 md:mb-5 md:gap-5 sm:grid-cols-2 lg:grid-cols-3'}>
            {sectionTwoPools.map(project => (
              <MarketplaceCard project={project} key={'rdy2earn' + project.id} />
            ))}
          </div>
          <Button className={'w-full'} visualType={'secondary'} href={'/marketplace'}>
            See more projects
          </Button>
        </Wrapper>
      </section>
      <HowToStart />
      <AppDemo
        slides={[
          { image: '/images/app-demo-1.png', title: 'Buy and sell tokens \nto get more points' },
          {
            image: '/images/app-demo-2.png',
            title: 'Become a product owner: create your own pools and get even more points',
          },
          {
            image: '/images/app-demo-3.png',
            title: 'Stake your PLTs and get rewards \nfor helping the ecosystem',
          },
        ]}
      />
      <section className={'mb-25 md:mb-50'}>
        <Wrapper>
          <div className={'grid-cols-[min-content_1fr] justify-between gap-5 md:grid lg:gap-35'}>
            <Title className={'mb-10'} size={'lg'} level={2}>
              Tokenize&nbsp;your business
            </Title>
            <Card size={'xl'}>
              <Title className={'mb-3'} size={'md'} level={4}>
                Issue a token
              </Title>
              <p className={'text-grey-dark text-base/[1.4] mb-10'}>
                Make your real world assets liquid and make a profit
              </p>
              {!address && (
                <button className={'cursor-pointer mt-6'} onClick={openConnectModal}>
                  <span className={'sr-only'}>Issue a token</span>
                  <span
                    className={
                      'inline-flex items-center justify-center bg-grey-light size-13 rounded-2xl before:size-9 before:bg-blue before:mask-[url(/icons/tick.svg)] before:mask-contain'
                    }
                  />
                </button>
              )}
              {address && (
                <Link className={'cursor-pointer mt-6'} href={'/my-companies/'}>
                  <span className={'sr-only'}>Issue a token</span>
                  <span
                    className={
                      'inline-flex items-center justify-center bg-grey-light size-13 rounded-2xl before:size-9 before:bg-blue before:mask-[url(/icons/tick.svg)] before:mask-contain'
                    }
                  />
                </Link>
              )}
            </Card>
          </div>
        </Wrapper>
      </section>
      <FAQ
        faqList={[
          {
            question: 'How am I protected from fraud?',
            answer: (
              <>
                <p>We aim to create a safe and secure environment for all users by combining these measures:</p>
                <ul>
                  <li>We use Know Your Client (KYC) protocols to verify every project</li>
                  <li>
                    Our platform uses audited smart contracts to ensure that transactions are secure and tamper-proof
                  </li>
                  <li>We provide resources to educate users on common scams and best practices for online security</li>
                  <li>
                    Our platform has a dispute resolution system in place to handle any issues that may arise during
                    transactions
                  </li>
                </ul>
              </>
            ),
          },
          {
            question: 'Can I get investing advice?',
            answer: (
              <>
                <p>
                  Every project on Slices is evaluated by AI and our users - you can check the rating on each project
                  card and make an informed decision.
                </p>
              </>
            ),
          },
          {
            question: 'Is RWA investing risky?',
            answer: (
              <>
                <p>
                  As any other investment, RWA investments depend on market volatility. However, they can also offer
                  higher returns if managed well, as they tap into the value of real-world assets.
                </p>
              </>
            ),
          },
        ]}
      />
    </CommonLayout>
  );
};

export default Home;
