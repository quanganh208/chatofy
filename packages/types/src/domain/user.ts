// User domain types — shape only, no runtime validation here

export interface User {
  id: string;
  email: string;
  displayName: string | null;
  createdAt: string;
}

export interface UserProfile extends User {
  preferredLanguage: 'vi' | 'en';
}
