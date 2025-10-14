export type Role = "admin" | "user";

export interface User {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  is_active: boolean;
}

export type AccessType = "gui" | "cli" | "both";
export interface SystemCredential {
  id: string;
  user_id: string;
  login_endpoint: string;
  access_scope: AccessType;
}

export interface System {
  id: string;
  group_id: string;
  name: string;
  ip_address: string;
  credentials: SystemCredential[];
}

export interface SystemCredentialSecret extends SystemCredential {
  password: string;
}

export interface GroupSummary {
  id: string;
  name: string;
  description?: string | null;
}

export interface GroupDetail extends GroupSummary {
  systems: System[];
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
}
