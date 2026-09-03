import { apiGet } from './client';

export interface VersionResponse {
  version: string;
  build_time: string;
}

export const systemApi = {
  getVersion: async (): Promise<VersionResponse> => {
    return apiGet<VersionResponse>('/version');
  },
};
