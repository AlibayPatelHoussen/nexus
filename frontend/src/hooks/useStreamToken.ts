import { useQuery } from '@tanstack/react-query'
import { getStreamToken } from '@/services/streamToken'

/**
 * The stream token, fetched ahead: a link built from it is ready inside the tap itself (a page
 * opened later, after waiting for it, stays blank in the app from the home screen).
 */
export function useStreamToken(): string | undefined {
  const { data } = useQuery({ queryKey: ['stream-token'], queryFn: getStreamToken, staleTime: 30 * 60_000, refetchInterval: 30 * 60_000 })
  return data
}
