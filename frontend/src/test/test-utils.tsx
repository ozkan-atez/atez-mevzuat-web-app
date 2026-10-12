import type { ReactNode } from 'react'
import { render as baseRender, renderHook as baseRenderHook, type RenderOptions, type RenderHookOptions } from '@testing-library/react'
import { AuthContext } from '../features/auth/AuthProvider'
import { testSession } from './auth-fixture'
export * from '@testing-library/react'
export function TestAuthProvider({children}:{children:ReactNode}) { return <AuthContext.Provider value={{status:'authenticated',session:testSession,error:null,expired:false,can:permission=>testSession.permissions.includes(permission),reload:async()=>{},logout:async()=>{},clearForbidden:()=>{}}}>{children}</AuthContext.Provider> }
export function render(ui:ReactNode,options:RenderOptions={}) { const Wrapper=options.wrapper;return baseRender(ui,{...options,wrapper:({children})=><TestAuthProvider>{Wrapper?<Wrapper>{children}</Wrapper>:children}</TestAuthProvider>}) }
export function renderHook<Result,Props>(render:(initialProps:Props)=>Result,options:RenderHookOptions<Props>={}) { const Wrapper=options.wrapper;return baseRenderHook(render,{...options,wrapper:({children})=><TestAuthProvider>{Wrapper?<Wrapper>{children}</Wrapper>:children}</TestAuthProvider>}) }
