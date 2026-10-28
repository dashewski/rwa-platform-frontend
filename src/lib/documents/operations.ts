import { gql } from '@apollo/client';
import { TypedDocumentNode } from '@graphql-typed-document-node/core';
import { ParentTypes } from '@/gql/graphql';
import { API_ENDPOINT } from '@/lib/config';
import { notifySessionExpired } from '@/lib/auth/session';

export interface DocumentItem {
  id: string;
  folderId: string;
  name: string;
  url: string;
  fileId: string;
  path: string;
  mimeType: string;
  size: number;
  ownerId: string;
  ownerType: string;
  creator: string;
  parentId: string;
  grandParentId: string;
  createdAt: number;
  updatedAt: number;
}

export interface FolderItem {
  id: string;
  name: string;
  parentId: string;
  ownerId: string;
  ownerType: string;
}

interface GetFoldersData {
  getFolders: FolderItem[];
}
interface GetFoldersVars {
  input?: { filter?: Record<string, unknown> };
}

interface CreateFolderData {
  createFolder: FolderItem;
}
interface CreateFolderVars {
  input: { name: string; parentId: string; type: ParentTypes };
}

interface GetDocumentsData {
  getDocuments: DocumentItem[];
}
interface GetDocumentsVars {
  input?: { filter?: Record<string, unknown> };
}

interface DeleteDocumentData {
  deleteDocument: string;
}
interface DeleteDocumentVars {
  id: string;
}

interface UpdateDocumentData {
  updateDocument: DocumentItem;
}
interface UpdateDocumentVars {
  input: { id: string; updateData: { name?: string; url?: string } };
}

export const GET_FOLDERS: TypedDocumentNode<GetFoldersData, GetFoldersVars> = gql`
  query GetFoldersForDocs($input: GetFoldersFilterInput) {
    getFolders(input: $input) {
      id
      name
      parentId
      ownerId
      ownerType
    }
  }
`;

export const CREATE_FOLDER: TypedDocumentNode<CreateFolderData, CreateFolderVars> = gql`
  mutation CreateFolderForDocs($input: CreateFolderInput!) {
    createFolder(input: $input) {
      id
      name
      parentId
      ownerId
      ownerType
    }
  }
`;

export const GET_DOCUMENTS: TypedDocumentNode<GetDocumentsData, GetDocumentsVars> = gql`
  query GetDocuments($input: GetDocumentsFilterInput) {
    getDocuments(input: $input) {
      id
      folderId
      name
      url
      fileId
      path
      mimeType
      size
      ownerId
      ownerType
      creator
      parentId
      grandParentId
      createdAt
      updatedAt
    }
  }
`;

export const DELETE_DOCUMENT: TypedDocumentNode<DeleteDocumentData, DeleteDocumentVars> = gql`
  mutation DeleteDocument($id: ID!) {
    deleteDocument(id: $id)
  }
`;

export const UPDATE_DOCUMENT: TypedDocumentNode<UpdateDocumentData, UpdateDocumentVars> = gql`
  mutation UpdateDocumentMeta($input: UpdateDocumentInput!) {
    updateDocument(input: $input) {
      id
      folderId
      name
      url
      fileId
      path
      mimeType
      size
      ownerId
      ownerType
      creator
      parentId
      grandParentId
      createdAt
      updatedAt
    }
  }
`;

export const uploadDocumentMultipart = async (
  folderId: string,
  name: string,
  file: File
): Promise<DocumentItem> => {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('folderId', folderId);
  formData.append('name', name);

  const response = await fetch(`${API_ENDPOINT}/api/documents/createDocument`, {
    method: 'POST',
    credentials: 'include',
    body: formData,
  });

  if (response.status === 401) notifySessionExpired();

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || 'Failed to upload document');
  }

  return response.json() as Promise<DocumentItem>;
};
