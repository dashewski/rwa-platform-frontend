'use client';

import React, { FC } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { DashboardLayout, Wrapper } from '@/components/layout';
import { Breadcrumbs } from '@/components/dashboard';
import { Button, Title } from '@/components/ui';
import { useQuery } from '@apollo/client/react';
import { GET_COMPANY } from '@/lib/company/operations';
import { GET_BUSINESS } from '@/lib/business/operations';
import { GET_POST } from '@/lib/blog/operations';
import Image from 'next/image';

type TextBlock = { type: 'text'; content: string };
type ImageBlock = { type: 'image'; link: string; external?: boolean };
type Block = TextBlock | ImageBlock;

function parseContent(content: string): Block[] {
  if (!content) return [];
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) return parsed as Block[];
  } catch {}
  return [{ type: 'text', content }];
}

const ReadPostPage: FC = () => {
  const params = useParams();
  const router = useRouter();
  const companyId = params.id as string;
  const projectId = params.projectId as string;
  const postId = params.postId as string;

  const { data: companyData } = useQuery(GET_COMPANY, { variables: { id: companyId }, skip: !companyId });
  const { data: businessData } = useQuery(GET_BUSINESS, { variables: { id: projectId }, skip: !projectId });
  const { data: postData, loading: postLoading } = useQuery(GET_POST, { variables: { id: postId }, skip: !postId });

  const company = companyData?.getCompany;
  const project = businessData?.getBusiness;
  const post = postData?.getPost;

  if (postLoading || !post) return null;

  const filesBase = process.env.NEXT_PUBLIC_FILE_ENDPOINT ?? 'https://192.168.100.20/files/';
  const blocks = parseContent(post.content);

  return (
    <DashboardLayout>
      <section className={'mb-12'}>
        <Wrapper>
          {company?.name && project?.name && (
            <Breadcrumbs
              items={[
                { name: company.name, url: `/my-companies/${companyId}` },
                { name: project.name, url: `/my-companies/${companyId}/projects/${projectId}` },
              ]}
              currentItem={post.title}
            />
          )}
          {/*<div className={'border-b-1 border-stroke-primary pb-6 flex justify-between'}>*/}
          {/*  <Title size={'xs'}>{post.title}</Title>*/}
          {/*  <Button*/}
          {/*    visualType={'quinary'}*/}
          {/*    type={'button'}*/}
          {/*    onClick={() => router.push(`/my-companies/${companyId}/projects/${projectId}/edit-post/${postId}`)}*/}
          {/*  >*/}
          {/*    Edit*/}
          {/*  </Button>*/}
          {/*</div>*/}
        </Wrapper>
      </section>

      <section>
        <Wrapper>
          <div className={'max-w-[800px] mx-auto mb-6'}>
            <p className={'text-[28px] font-semibold md:text-[36px] mb-4'}>{post.title}</p>

            <p className={'text-sm text-label-tertiary mb-6'}>
              {new Date(post.createdAt * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
            </p>

            <div className={'flex flex-col'}>
              {blocks.map((block, i) =>
                block.type === 'image' ? (
                  <div key={i} className={'rounded-xl overflow-hidden my-2'}>
                    <Image
                      src={block.external ? block.link : filesBase + block.link.split('/').pop()}
                      alt={`Post image ${i + 1}`}
                      width={800}
                      height={450}
                      className={'w-full object-cover rounded-xl'}
                    />
                  </div>
                ) : (
                  <p key={i} className={'leading-7 whitespace-pre-wrap min-h-[1.75rem] my-2'}>{block.content}</p>
                )
              )}
            </div>
          </div>
        </Wrapper>
      </section>
    </DashboardLayout>
  );
};

export default ReadPostPage;
