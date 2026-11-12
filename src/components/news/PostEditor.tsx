'use client';

import React, { forwardRef, KeyboardEvent, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useMutation, useQuery } from '@apollo/client/react';
import { CREATE_GALLERY, GET_GALLERIES } from '@/lib/gallery/operations';
import { GalleryParentTypes } from '@/gql/graphql';
import { Icon, toast } from '@/components/ui';
import clsx from 'clsx';
import UploadMediaModal from './UploadMediaModal';
import Image from 'next/image';
import { API_ENDPOINT } from '@/lib/config';
import { clearSession, getAccessToken } from '@/lib/auth/tokenManager';

type TextBlock = { type: 'text'; id: string; content: string };
type ImageBlock = { type: 'image'; id: string; link: string };
type Block = TextBlock | ImageBlock;

let blockIdCounter = 0;
const nextId = () => String(++blockIdCounter);

const uploadImageMultipart = async (galleryId: string, file: File): Promise<{ id: string; url: string }> => {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('galleryId', galleryId);
  formData.append('name', file.name);
  formData.append('description', '');

  const token = await getAccessToken();

  const response = await fetch(`${API_ENDPOINT}/api/upload/createImage`, {
    method: 'POST',
    credentials: 'include',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: formData,
  });

  if (response.status === 401) clearSession();

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || 'Failed to upload image');
  }

  return (await response.json()) as { id: string; url: string };
};

export interface PostEditorData {
  title: string;
  content: string;
  imageLinks: string[];
}

export interface PostEditorHandle {
  getData(): PostEditorData | null;
  isUploading(): boolean;
}

interface PostEditorProps {
  projectId: string;
  projectName?: string;
  initialTitle?: string;
  initialContent?: string;
}

function parseBlocks(content: string): Block[] {
  if (!content) return [{ type: 'text', id: nextId(), content: '' }];
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) {
      return parsed.map(b =>
        b.type === 'image'
          ? ({ type: 'image', id: nextId(), link: b.link } as ImageBlock)
          : ({ type: 'text', id: nextId(), content: b.content ?? '' } as TextBlock)
      );
    }
  } catch {}
  return [{ type: 'text', id: nextId(), content }];
}

const PostEditor = forwardRef<PostEditorHandle, PostEditorProps>(({ projectId, projectName, initialTitle = '', initialContent = '' }, ref) => {
  const [postTitle, setPostTitle] = useState(initialTitle);
  const [titleError, setTitleError] = useState('');
  const [blocks, setBlocks] = useState<Block[]>(() => parseBlocks(initialContent));
  const [uploadModalBlockId, setUploadModalBlockId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [focusBlockId, setFocusBlockId] = useState<string | null>(null);

  const titleRef = useRef<HTMLTextAreaElement>(null);
  const textareaRefs = useRef<Map<string, HTMLTextAreaElement>>(new Map());

  useEffect(() => {
    const el = titleRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = el.scrollHeight + 'px';
    }
  }, []);

  useEffect(() => {
    if (!focusBlockId) return;
    const el = textareaRefs.current.get(focusBlockId);
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
    setFocusBlockId(null);
  }, [focusBlockId]);

  const { data: galleriesData, refetch: refetchGalleries } = useQuery(GET_GALLERIES, {
    variables: { input: { filter: { parentId: projectId } } },
  });
  const [createGallery] = useMutation(CREATE_GALLERY);
  const gallery = galleriesData?.getGalleries[0];

  useImperativeHandle(ref, () => ({
    getData() {
      const isTitleValid = postTitle.length > 2;
      const textContent = blocks
        .filter((b): b is TextBlock => b.type === 'text')
        .map(b => b.content)
        .join('')
        .trim();
      const isContentValid = textContent.length > 2;

      if (!isTitleValid) setTitleError('Enter title');
      if (!isContentValid) toast('Content is too short.', 'error');
      if (!isTitleValid || !isContentValid) return null;

      const serializedBlocks = blocks.map(b =>
        b.type === 'image'
          ? { type: 'image', link: b.link }
          : { type: 'text', content: b.content }
      );

      return {
        title: postTitle,
        content: JSON.stringify(serializedBlocks),
        imageLinks: blocks.filter((b): b is ImageBlock => b.type === 'image').map(b => b.link),
      };
    },
    isUploading: () => uploading,
  }));

  const updateTextBlock = (id: string, content: string) => {
    setBlocks(prev => prev.map(b => (b.id === id ? { ...b, content } : b)));
  };

  const removeBlock = (id: string) => {
    setBlocks(prev => {
      const idx = prev.findIndex(b => b.id === id);
      if (idx === -1) return prev;
      const filtered = prev.filter(b => b.id !== id);
      // merge adjacent text blocks when image between them is removed
      if (
        idx > 0 &&
        idx < prev.length - 1 &&
        prev[idx - 1].type === 'text' &&
        prev[idx + 1].type === 'text'
      ) {
        const before = prev[idx - 1] as TextBlock;
        const after = prev[idx + 1] as TextBlock;
        const merged: TextBlock = { type: 'text', id: before.id, content: before.content + after.content };
        return [...filtered.slice(0, idx - 1), merged, ...filtered.slice(idx + 1)];
      }
      return filtered;
    });
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>, block: TextBlock, blockIndex: number) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const newId = nextId();
      setBlocks(prev => {
        const idx = prev.findIndex(b => b.id === block.id);
        const newBlock: TextBlock = { type: 'text', id: newId, content: '' };
        return [...prev.slice(0, idx + 1), newBlock, ...prev.slice(idx + 1)];
      });
      setFocusBlockId(newId);
    }

    if (e.key === 'Backspace' && block.content === '') {
      e.preventDefault();
      const textBlocks = blocks.filter((b): b is TextBlock => b.type === 'text');
      if (textBlocks.length <= 1) return;
      const currentTextIdx = textBlocks.findIndex(b => b.id === block.id);
      const prevTextBlock = textBlocks[currentTextIdx - 1];
      removeBlock(block.id);
      if (prevTextBlock) setFocusBlockId(prevTextBlock.id);
    }

    if (e.key === 'ArrowUp' && blockIndex === 0) {
      const titleEl = document.querySelector<HTMLInputElement>('input[placeholder="Title post"]');
      titleEl?.focus();
    }
  };

  const ensureGallery = async (): Promise<string> => {
    if (gallery?.id) return gallery.id;
    const result = await createGallery({
      variables: { input: { name: projectName ?? 'Gallery', parentId: projectId, type: GalleryParentTypes.Business } },
    });
    await refetchGalleries();
    return result.data!.createGallery.id;
  };

  const handleFileSelected = async (file: File) => {
    if (!uploadModalBlockId) return;

    const insertAfterBlockId = uploadModalBlockId;
    setUploadModalBlockId(null);
    setUploading(true);

    try {
      const galleryId = await ensureGallery();
      const uploaded = await uploadImageMultipart(galleryId, file);

      const newTextId = nextId();
      setBlocks(prev => {
        const idx = prev.findIndex(b => b.id === insertAfterBlockId);
        if (idx === -1) return prev;
        const imageBlock: ImageBlock = { type: 'image', id: nextId(), link: uploaded.url };
        const textBlock: TextBlock = { type: 'text', id: newTextId, content: '' };
        return [...prev.slice(0, idx + 1), imageBlock, textBlock, ...prev.slice(idx + 1)];
      });
      setFocusBlockId(newTextId);
    } catch {
      toast('Failed to upload image.', 'error');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className={'max-w-[800px] mx-auto mb-6'}>
      <textarea
        ref={titleRef}
        className={clsx(
          'w-full text-[28px] font-semibold md:text-[36px] outline-none placeholder:text-label-tertiary mb-4 resize-none overflow-hidden leading-tight',
          titleError && 'border-b-1 border-red-500'
        )}
        placeholder={'Title post'}
        rows={1}
        value={postTitle}
        onKeyDown={e => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            const firstText = blocks.find((b): b is TextBlock => b.type === 'text');
            if (firstText) setFocusBlockId(firstText.id);
          }
        }}
        onChange={e => {
          e.target.style.height = 'auto';
          e.target.style.height = e.target.scrollHeight + 'px';
          if (e.target.value.length > 2) setTitleError('');
          setPostTitle(e.target.value);
        }}
      />

      <div className={'flex flex-col'}>
        {blocks.map((block, blockIndex) => {
          if (block.type === 'image') {
            return (
              <div key={block.id} className={'group relative rounded-xl overflow-hidden my-2'}>
                <Image
                  src={
                    (process.env.NEXT_PUBLIC_FILE_ENDPOINT ?? 'https://192.168.100.20/files/') +
                    block.link.split('/').pop()
                  }
                  alt={'Post image'}
                  width={800}
                  height={450}
                  className={'w-full object-cover rounded-xl'}
                />
                <button
                  type={'button'}
                  onClick={() => removeBlock(block.id)}
                  className={
                    'absolute top-3 right-3 bg-white rounded-full w-7 h-7 flex items-center justify-center shadow opacity-0 group-hover:opacity-100 transition-opacity hover:bg-gray-100 text-base'
                  }
                >
                  ×
                </button>
              </div>
            );
          }

          return (
            <div key={block.id} className={'group relative flex items-start gap-2 min-h-[1.75rem] my-2'}>
              <button
                type={'button'}
                disabled={uploading}
                onClick={() => setUploadModalBlockId(prev => prev === block.id ? null : block.id)}
                className={'absolute top-0 -left-11.5 size-9.5 flex items-center justify-center rounded text-label-tertiary opacity-0 group-hover:opacity-100 hover:bg-gray-100 hover:text-black transition-all disabled:cursor-not-allowed text-sm leading-none select-none'}
              >
                <Icon className={'size-5'} name={'plus'}/>
              </button>
              <textarea
                ref={el => { if (el) textareaRefs.current.set(block.id, el); else textareaRefs.current.delete(block.id); }}
                className={'flex-1 resize-none outline-none placeholder:text-label-tertiary overflow-hidden leading-7'}
                placeholder={'Type something, or press + to add an image...'}
                value={block.content}
                rows={1}
                onChange={e => {
                  e.target.style.height = 'auto';
                  e.target.style.height = e.target.scrollHeight + 'px';
                  updateTextBlock(block.id, e.target.value);
                }}
                onKeyDown={e => handleKeyDown(e, block, blockIndex)}
              />
              {uploadModalBlockId === block.id && (
                <UploadMediaModal
                  uploading={uploading}
                  onClose={() => setUploadModalBlockId(null)}
                  onFileSelected={handleFileSelected}
                />
              )}
            </div>
          );
        })}
      </div>

    </div>
  );
});

PostEditor.displayName = 'PostEditor';

export default PostEditor;