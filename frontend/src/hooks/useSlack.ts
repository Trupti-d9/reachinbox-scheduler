import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { api } from '../api/client';

export function useSlack() {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ['slack'], queryFn: api.slackStatus });

  const disconnect = useMutation({
    mutationFn: api.slackDisconnect,
    onSuccess: () => {
      toast.success('Slack disconnected');
      qc.invalidateQueries({ queryKey: ['slack'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const test = useMutation({
    mutationFn: api.slackTest,
    onSuccess: () => toast.success('Test message sent to Slack'),
    onError: (e: Error) => toast.error(e.message),
  });

  return { status, disconnect, test };
}
