import React, {AnchorHTMLAttributes, FC} from 'react';
import Link from 'next/link';

const ButtonLink: FC<AnchorHTMLAttributes<HTMLAnchorElement>> = ({ href, children, target, rel }) => {
  if (!href) return null;

  return (
    <Link href={href} target={target} rel={rel} className={'text-white text-base/[1.4] font-medium tr-d-all hover:text-blue-accent focus-visible:text-blue-accent active:text-white'}>
      {children}
    </Link>
  );
};

export default ButtonLink;
