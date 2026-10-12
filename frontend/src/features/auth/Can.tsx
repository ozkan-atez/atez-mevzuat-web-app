import type { ReactNode } from 'react'
import { useCan } from './AuthProvider'
export function Can({permission,children}:{permission:string;children:ReactNode}) { return useCan(permission)?children:null }
