'use client';

import React, { FC, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, ButtonBorderDash, Icon, Pagination, Title, toast } from '@/components/ui';
import { useQuery } from '@apollo/client/react';
import { GET_BLOGS, GET_POSTS } from '@/lib/blog/operations';
import Link from 'next/link';

const PAGE_SIZE = 8;

function extractText(content: string): string {
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((b: { type: string }) => b.type === 'text')
        .map((b: { content: string }) => b.content)
        .join(' ')
        .trim();
    }
  } catch {}
  return content;
}

// createdAt comes from the API in unix seconds (Date wants milliseconds)
function timeAgo(createdAtSec: number): string {
  const diffMs = Date.now() - new Date(createdAtSec * 1000).getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHour = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);
  const diffWeek = Math.floor(diffDay / 7);
  const diffMonth = Math.floor(diffDay / 30);
  const diffYear = Math.floor(diffDay / 365);

  if (diffYear >= 1) return `${diffYear} year${diffYear > 1 ? 's' : ''} ago`;
  if (diffMonth >= 1) return `${diffMonth} month${diffMonth > 1 ? 's' : ''} ago`;
  if (diffWeek >= 1) return `${diffWeek} week${diffWeek > 1 ? 's' : ''} ago`;
  if (diffDay >= 1) return `${diffDay} day${diffDay > 1 ? 's' : ''} ago`;
  if (diffHour >= 1) return `${diffHour} hour${diffHour > 1 ? 's' : ''} ago`;
  if (diffMin >= 1) return `${diffMin} minute${diffMin > 1 ? 's' : ''} ago`;
  return 'just now';
}

interface NewsListProps {
  projectId: string;
  companyId?: string;
  projectName?: string;
  canEdit?: boolean;
}

const NewsList: FC<NewsListProps> = ({ projectId, companyId, canEdit = false }) => {
  const router = useRouter();

  const [page, setPage] = useState(1);
  const { data: blogsData } = useQuery(GET_BLOGS, {
    variables: { input: { filter: { parentId: projectId } } },
  });

  const blog = blogsData?.getBlogs[0];

  const { data: postsData } = useQuery(GET_POSTS, {
    variables: { input: { filter: { blogId: blog?.id } } },
    skip: !blog?.id,
  });

  const navigateToCreate = () => {
    const params = new URLSearchParams({ projectId });
    if (companyId) params.set('companyId', companyId);
    router.push(`/create-post?${params}`);
  };

  const navigateToEdit = (postId: string) => {
    const params = new URLSearchParams({ projectId });
    if (companyId) params.set('companyId', companyId);
    router.push(`/edit-post/${postId}?${params}`);
  };

  const posts = postsData?.getPosts ?? [];
  const totalPages = Math.ceil(posts.length / PAGE_SIZE);
  const pagePosts = posts.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  if (posts.length === 0 && !canEdit) return null;

  return (
    <>
      <div className={'flex items-center justify-between mb-6'}>
        <Title size={'xs'} level={2}>
          News
        </Title>
        {posts.length > 0 && canEdit && (
          <Button visualType={'quaternary'} onClick={navigateToCreate}>
            <Icon name={'plus'} />
            Add post
          </Button>
        )}
      </div>

      {posts.length === 0 && canEdit && (
        <ButtonBorderDash className={'min-h-42.5'} onClick={navigateToCreate}>
          Create post
        </ButtonBorderDash>
      )}

      {posts.length > 0 && (
        <>
          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />

          <div className={'flex flex-col gap-3 mt-4'}>
            {pagePosts.map(post => (
              <div
                key={post.id}
                className={
                  'flex items-center justify-between gap-4 py-4.5 px-5 border-1 border-stroke-primary rounded-xl'
                }
              >
                <div className={'flex-1 min-w-0'}>
                  <div className={'flex items-center gap-2 mb-2'}>
                    <Link
                      href={`/post/${post.id}`}
                      className={'text-base font-semibold hover:underline text-left'}
                    >
                      {post.title}
                    </Link>
                    <span className={'shrink-0 text-xs font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-600'}>
                      {timeAgo(post.createdAt)}
                    </span>
                  </div>
                  <p className={'text-sm text-label-secondary max-w-155 line-clamp-2'}>{extractText(post.content)}</p>
                </div>
                {canEdit && (
                  <div className={'shrink-0 flex items-center gap-2'}>
                    <Button visualType={'quinary'} type={'button'} onClick={() => navigateToEdit(post.id)}>
                      <Icon name={'edit'} className={'size-3.5'} />
                      Edit
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className={'mt-4'}>
            <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
          </div>
        </>
      )}
    </>
  );
};

export default NewsList;
