import { createContext, useContext } from 'react';
import { api } from './api';

export type WorkspaceDataClient = Pick<
  typeof api,
  | 'project'
  | 'projects'
  | 'renameProject'
  | 'folders'
  | 'cards'
  | 'card'
  | 'visit'
  | 'capture'
  | 'saveCard'
  | 'copyCard'
  | 'deleteCard'
  | 'restoreCard'
  | 'position'
  | 'links'
  | 'connect'
  | 'disconnect'
  | 'reconnectLink'
  | 'marks'
  | 'createMark'
  | 'editMark'
  | 'deleteMark'
  | 'moveSelection'
  | 'trashSelection'
>;

export const WorkspaceClient = createContext<WorkspaceDataClient>(api);
export const useWorkspaceClient = () => useContext(WorkspaceClient);
