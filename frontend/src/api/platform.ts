import {api} from './client'
import type {PlatformResources} from './models'

export const getPlatformResources=()=>api<PlatformResources>('/api/platform/resources')
