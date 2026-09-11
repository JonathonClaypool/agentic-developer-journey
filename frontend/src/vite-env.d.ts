/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_AZURE_SUBSCRIPTION_ID?: string
}

interface ImportMeta {
	readonly env: ImportMetaEnv
}
