'use client';

import clsx from 'clsx';
import React, { FC, useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';

import { Wrapper } from '@/components/layout';
import { ButtonLink, Socials } from '@/components/ui';
import { SUPPORT_URL } from '@/lib/config';

const Footer: FC = () => {
  const [isNotFound, setIsNotFound] = useState(false);
  const links = [
    {
      text: 'Marketplace',
      link: '#',
    },
    {
      text: 'Community',
      link: '#',
    },
    {
      text: 'Tokenize your business',
      link: '/tokenization/',
    },
    {
      text: 'Whitepaper',
      link: '#',
    },
    {
      text: 'Privacy Policy',
      link: '#',
    },
    {
      text: 'Terms of service',
      link: '/terms-of-service/',
    },
    {
      text: 'FAQ',
      link: '#',
    },
    {
      text: 'Support',
      link: SUPPORT_URL,
      external: true,
    },
    {
      text: 'Contact Us',
      link: '#',
    },
  ];

  useEffect(() => {
    setIsNotFound(!!document.querySelector('[data-not-found-page]'));
  }, []);

  return (
    <footer className={'relative'}>
      <picture>
        <source srcSet='/images/footer-bg-d.png' media='(min-width: 1024px)' />
        <Image
          className={clsx(
            'absolute bottom-0 w-full h-[729px] object-cover object-center lg:h-[577px]',
            isNotFound && 'hidden'
          )}
          src={'/images/footer-bg.png'}
          width={'1920'}
          height={'729'}
          alt={''}
          priority
        />
      </picture>
      <Wrapper>
        <div
          className={
            'z-1 relative py-10 flex flex-col items-center gap-8 lg:grid lg:grid-cols-[max-content_max-content_max-content] justify-between'
          }
        >
          <Link className={'flex items-center justify-center w-30 lg:order-1'} href={'/public'}>
            <Image className={'w-full h-auto'} src={'/images/logo.svg'} width={'120'} height={'34'} alt={''} />
          </Link>
          <ul
            className={
              'flex flex-col items-center gap-3 lg:grid lg:grid-cols-3 lg:gap-y-4 lg:gap-x-10 lg:row-span-2 lg:order-2 xl:gap-x-22 '
            }
          >
            {links &&
              links.length > 0 &&
              links.map(({ text, link, external }) => (
                <li key={'footer' + text}>
                  <ButtonLink href={link} {...(external && { target: '_blank', rel: 'noopener noreferrer' })}>
                    {text}
                  </ButtonLink>
                </li>
              ))}
          </ul>
          <div className={'lg:order-3'}>
            <Socials color={'light'} gap={'md'} />
          </div>
          <div className={'text-blue-dim text-xs/[1.3] font-normal lg:order-5'}>Design by OUT.AGENCY</div>
          <div className={'text-blue-dim text-xs/[1.3] font-normal max-md:-mt-3 lg:order-4'}>
            Copyright © 2025 Slices
          </div>
        </div>
      </Wrapper>
    </footer>
  );
};

export default Footer;
