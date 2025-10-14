import api from "@/services/api";
import { GroupDetail, GroupSummary } from "@/types";

export const fetchGroups = async (): Promise<GroupSummary[]> => {
  const { data } = await api.get<GroupSummary[]>("/groups/");
  return data;
};

export const fetchGroupDetail = async (groupId: string): Promise<GroupDetail> => {
  const { data } = await api.get<GroupDetail>(`/groups/${groupId}`);
  return data;
};

export const createGroup = async (payload: { name: string; description?: string | null }) => {
  const { data } = await api.post<GroupSummary>("/groups/", payload);
  return data;
};

export const updateGroup = async (groupId: string, payload: { name?: string; description?: string | null }) => {
  const { data } = await api.patch<GroupSummary>(`/groups/${groupId}`, payload);
  return data;
};

export const deleteGroup = async (groupId: string) => {
  await api.delete(`/groups/${groupId}`);
};
