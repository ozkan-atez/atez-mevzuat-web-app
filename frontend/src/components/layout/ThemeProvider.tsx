import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ConfigProvider, theme as antTheme } from 'antd'

export type Palette = 'violet' | 'ocean' | 'emerald' | 'aurora'
export type Appearance = 'dark' | 'light'

const paletteColors: Record<Palette, { dark: string; light: string }> = {
  violet: { dark: '#c5aff5', light: '#7753af' },
  ocean: { dark: '#73dcff', light: '#1c78d4' },
  emerald: { dark: '#57e3ae', light: '#157a5a' },
  aurora: { dark: '#ffb8ef', light: '#7354c9' },
}

interface ThemeContextValue {
  appearance: Appearance
  setAppearance: (value: Appearance) => void
  palette: Palette
  setPalette: (value: Palette) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

function savedAppearance(): Appearance {
  try { return localStorage.getItem('atez-theme') === 'light' ? 'light' : 'dark' } catch { return 'dark' }
}

function savedPalette(): Palette {
  try {
    const value = localStorage.getItem('atez-palette')
    return value && value in paletteColors ? value as Palette : 'violet'
  } catch { return 'violet' }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [appearance, setAppearance] = useState<Appearance>(savedAppearance)
  const [palette, setPalette] = useState<Palette>(savedPalette)

  useEffect(() => {
    document.documentElement.dataset.theme = appearance
    document.documentElement.dataset.palette = palette
    try {
      localStorage.setItem('atez-theme', appearance)
      localStorage.setItem('atez-palette', palette)
    } catch { /* Storage may be unavailable. */ }
  }, [appearance, palette])

  const context = useMemo(() => ({ appearance, setAppearance, palette, setPalette }), [appearance, palette])
  return (
    <ThemeContext.Provider value={context}>
      <ConfigProvider componentSize="middle" theme={{
        algorithm: appearance === 'dark' ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm,
        token: {
          colorPrimary: paletteColors[palette][appearance],
          colorInfo: paletteColors[palette][appearance],
          colorInfoText: paletteColors[palette][appearance],
          colorSuccessText: appearance === 'dark' ? '#78d5ae' : '#16724f',
          colorWarningText: appearance === 'dark' ? '#f4c36a' : '#946000',
          colorErrorText: appearance === 'dark' ? '#fb8d9b' : '#b52e46',
          colorBgContainer: appearance === 'dark' ? '#16151d' : '#ffffff',
          colorBgElevated: appearance === 'dark' ? '#1e1b27' : '#ffffff',
          colorText: appearance === 'dark' ? '#f2f0f7' : '#272135',
          colorTextSecondary: appearance === 'dark' ? '#aaa6b4' : '#756980',
          colorBgBase: appearance === 'dark' ? '#0c0c11' : '#f5f3f9',
          colorTextBase: appearance === 'dark' ? '#f2f0f7' : '#272135',
          fontFamily: 'Geist, system-ui, sans-serif',
          borderRadius: 10,
          fontSize: 14,
          fontSizeSM: 12,
          fontSizeLG: 16,
          controlHeight: 36,
          controlHeightSM: 32,
          controlHeightLG: 44,
          padding: 16,
          paddingLG: 24,
          margin: 16,
          lineHeight: 1.6,
        },
        components: {
          Button: { colorPrimary: paletteColors[palette][appearance], colorPrimaryHover: paletteColors[palette][appearance], colorPrimaryActive: paletteColors[palette][appearance], primaryColor: appearance === 'dark' ? '#191225' : '#ffffff', defaultColor: appearance === 'dark' ? '#f2f0f7' : '#272135', defaultBg: appearance === 'dark' ? '#1e1b27' : '#ffffff', defaultBorderColor: appearance === 'dark' ? '#51495e' : '#d7cfe1', primaryShadow: 'none', paddingInline: 16, paddingInlineSM: 12 },
          Card: { bodyPadding: 24, bodyPaddingSM: 16, headerFontSize: 16, headerFontSizeSM: 14 },
          Form: { itemMarginBottom: 20, verticalLabelPadding: '0 0 8px' },
          Modal: { titleFontSize: 18 },
          Table: { cellPaddingBlock: 14, cellPaddingInline: 16, cellPaddingBlockSM: 10, cellPaddingInlineSM: 12 },
          Menu: { itemBg: 'transparent', itemSelectedBg: 'var(--atez-accent-soft)', itemSelectedColor: paletteColors[palette][appearance] },
        },
      }}>
        {children}
      </ConfigProvider>
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme requires ThemeProvider')
  return context
}
