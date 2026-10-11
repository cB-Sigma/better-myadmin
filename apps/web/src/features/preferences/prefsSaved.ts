import { useQueryClient } from '@tanstack/react-query'
import { qk } from '../../lib/queryKeys'

/**
 * After a preferences save: UserPreferencesHandler::loadUserPreferences for the running app — the
 * client configuration (config-public) and everything of the server are read again.
 */
export function usePrefsSaved(server: number): () => Promise<void> {
  const qc = useQueryClient()
  return async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: qk.config }),
      qc.invalidateQueries({ queryKey: qk.srv(server) }),
    ])
  }
}
