import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';

export interface CreateStaffUserInput {
  email: string;
  password: string;
  displayName: string;
  role: 'admin' | 'staff';
}

export interface CreateStaffUserResult {
  uid: string;
  email: string;
  displayName: string;
  role: 'admin' | 'staff';
}

export async function createStaffUser(input: CreateStaffUserInput): Promise<CreateStaffUserResult> {
  const callable = httpsCallable<CreateStaffUserInput, CreateStaffUserResult>(functions, 'createStaffUser');
  const result = await callable(input);
  return result.data;
}
