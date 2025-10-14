import api from "@/services/api";
import { AccessType, System, SystemCredentialSecret } from "@/types";

export interface CredentialFormValue {
  id?: string;
  user_id: string;
  login_endpoint: string;
  access_scope: AccessType;
  password?: string;
}

export interface SystemFormValues {
  name: string;
  ip_address: string;
  credentials: CredentialFormValue[];
}

export const fetchSystems = async (params: { group_id?: string; search?: string; access_type?: AccessType }) => {
  const { data } = await api.get<System[]>("/systems/", { params });
  return data;
};

export const createSystem = async (groupId: string, payload: SystemFormValues) => {
  const { data } = await api.post<System>(
    "/systems/",
    {
      ...payload,
      credentials: payload.credentials.map((credential) => ({
        user_id: credential.user_id,
        login_endpoint: credential.login_endpoint,
        access_scope: credential.access_scope,
        password: credential.password,
      })),
    },
    { params: { group_id: groupId } }
  );
  return data;
};

export const updateSystem = async (systemId: string, payload: Partial<SystemFormValues>) => {
  const { data } = await api.patch<System>(`/systems/${systemId}`, {
    ...payload,
    credentials: payload.credentials?.map((credential) => ({
      id: credential.id,
      user_id: credential.user_id,
      login_endpoint: credential.login_endpoint,
      access_scope: credential.access_scope,
      password: credential.password,
    })),
  });
  return data;
};

export const deleteSystem = async (systemId: string) => {
  await api.delete(`/systems/${systemId}`);
};

export interface GuiTokenPayload {
  token: string;
  payload: {
    system_id: string;
    user_id: string;
    password: string;
    login_endpoint: string;
  };
}

export const requestGuiToken = async (systemId: string) => {
  const { data } = await api.post<GuiTokenPayload>(`/gui/${systemId}/token`);
  return data;
};

export const fetchSystemCredentialsWithSecrets = async (systemId: string) => {
  const { data } = await api.get<SystemCredentialSecret[]>(`/systems/${systemId}/credentials`);
  return data;
};
