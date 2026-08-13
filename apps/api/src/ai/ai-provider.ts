import type { GeneratedListing } from '@estateforge/shared'

export interface AIProvider {
  generate(prompt: string): Promise<GeneratedListing>
}