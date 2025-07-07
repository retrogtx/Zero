import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { backgroundQueueAtom, isThreadInBackgroundQueueAtom } from '@/store/backgroundQueue';
import type { IGetThreadResponse } from '../../server/src/lib/driver/types';
import { useSearchValue } from '@/hooks/use-search-value';
import { useTRPC } from '@/providers/query-provider';
import useSearchLabels from './use-labels-search';
import { useSession } from '@/lib/auth-client';
import { useAtom, useAtomValue } from 'jotai';
import { useSettings } from './use-settings';
import { usePrevious } from './use-previous';
import type { ParsedMessage } from '@/types';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router';
import { useTheme } from 'next-themes';
import { useQueryState } from 'nuqs';

export const useThreads = () => {
  const { folder } = useParams<{ folder: string }>();
  const [searchValue] = useSearchValue();
  const [backgroundQueue] = useAtom(backgroundQueueAtom);
  const isInQueue = useAtomValue(isThreadInBackgroundQueueAtom);
  const trpc = useTRPC();
  const { labels, setLabels } = useSearchLabels();
  const [sortOrder] = useQueryState('sort', { defaultValue: 'new' });

  // Track current date window for oldest-first pagination
  const [currentDateWindow, setCurrentDateWindow] = useState<{
    start: string;
    end: string;
    yearOffset: number;
  } | null>(null);

  // Fetch the earliest available message date only when we need it (oldest-first sort)
  const {
    data: earliestDate,
  } = useQuery(
    trpc.mail.earliestDate.queryOptions(undefined, {
      enabled: sortOrder === 'old',
      staleTime: Infinity,
    }),
  );

  // Initialize date window when we have earliestDate and sort is 'old'
  useEffect(() => {
    if (sortOrder === 'old' && earliestDate && !currentDateWindow) {
      const [y, m, d] = earliestDate.split('/').map((v) => Number(v));
      const end = `${y + 1}/${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}`;
      setCurrentDateWindow({
        start: earliestDate,
        end,
        yearOffset: 0,
      });
    } else if (sortOrder === 'new') {
      setCurrentDateWindow(null);
    }
  }, [sortOrder, earliestDate, currentDateWindow]);

  // When sorting by oldest, we modify the search query to include a very old date
  // range, which makes Gmail naturally return older emails first
  const searchQuery = useMemo(() => {
    if (sortOrder === 'old') {
      if (!currentDateWindow) return '';

      const baseQuery = searchValue.value || '';
      const oldDateQuery = `after:${currentDateWindow.start} before:${currentDateWindow.end}`;
      return baseQuery ? `${baseQuery} ${oldDateQuery}` : oldDateQuery;
    }
    return searchValue.value;
  }, [searchValue.value, sortOrder, currentDateWindow]);

  const threadsQuery = useInfiniteQuery(
    trpc.mail.listThreads.infiniteQueryOptions(
      {
        q: searchQuery,
        folder,
        labelIds: labels,
      },
      {
        initialCursor: '',
        getNextPageParam: (lastPage) => lastPage?.nextPageToken ?? null,
        staleTime: 60 * 1000 * 60, // 1 minute
        refetchOnMount: true,
        refetchIntervalInBackground: true,
      },
    ),
  );

  // Flatten threads from all pages and sort by receivedOn date (newest first)

  const threads = useMemo(() => {
    const base = threadsQuery.data
      ? threadsQuery.data.pages
          .flatMap((e) => e.threads)
          .filter(Boolean)
          .filter((e) => !isInQueue(`thread:${e.id}`))
      : [];
    
    if (sortOrder === 'old') {
      // For oldest-first, we need to reverse the entire flattened array
      // This gives us the chronologically oldest emails first
      return [...base].reverse();
    }
    
    return base;
  }, [threadsQuery.data, isInQueue, sortOrder]);

  const isEmpty = useMemo(() => threads.length === 0, [threads]);
  const isReachingEnd =
    isEmpty ||
    (threadsQuery.data &&
      !threadsQuery.data.pages[threadsQuery.data.pages.length - 1]?.nextPageToken);
  
  const loadMore = async () => {
    if (threadsQuery.isLoading || threadsQuery.isFetching) return;
    
    // For oldest-first sorting, when we reach the end of current window, expand the date range
    if (sortOrder === 'old' && isReachingEnd && currentDateWindow && earliestDate) {
      const [startY, startM, startD] = earliestDate.split('/').map((v) => Number(v));
      const nextYearOffset = currentDateWindow.yearOffset + 1;
      
      // Expand the end date by one more year
      const newEnd = `${startY + nextYearOffset + 1}/${String(startM).padStart(2, '0')}/${String(startD).padStart(2, '0')}`;
      
      setCurrentDateWindow({
        start: earliestDate, // Keep the original start
        end: newEnd,
        yearOffset: nextYearOffset,
      });
      
      // Refetch with the expanded date range
      await threadsQuery.refetch();
    } else {
      await threadsQuery.fetchNextPage();
    }
  };

  return [threadsQuery, threads, isReachingEnd, loadMore] as const;
};

export const useThread = (threadId: string | null, historyId?: string | null) => {
  const { data: session } = useSession();
  const [_threadId] = useQueryState('threadId');
  const id = threadId ? threadId : _threadId;
  const trpc = useTRPC();
  //   const { data } = useSettings();
  //   const { resolvedTheme } = useTheme();

  const previousHistoryId = usePrevious(historyId ?? null);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!historyId || !previousHistoryId || historyId === previousHistoryId) return;
    queryClient.invalidateQueries({ queryKey: trpc.mail.get.queryKey({ id: id! }) });
  }, [historyId, previousHistoryId, id]);

  const threadQuery = useQuery(
    trpc.mail.get.queryOptions(
      {
        id: id!,
      },
      {
        enabled: !!id && !!session?.user.id,
        staleTime: 1000 * 60 * 60, // 60 minutes
      },
    ),
  );

  //   const isTrustedSender = useMemo(
  //     () =>
  //       !!data?.settings?.externalImages ||
  //       !!data?.settings?.trustedSenders?.includes(threadQuery.data?.latest?.sender.email ?? ''),
  //     [data?.settings, threadQuery.data?.latest?.sender.email],
  //   );

  //   const prefetchEmailContent = async (message: ParsedMessage) => {
  //     return queryClient.prefetchQuery({
  //       queryKey: ['email-content', message.id, isTrustedSender, resolvedTheme],
  //       queryFn: async () => {
  //         const result = await processEmailContent({
  //           html: message.decodedBody ?? '',
  //           shouldLoadImages: isTrustedSender,
  //           theme: (resolvedTheme as 'light' | 'dark') || 'light',
  //         });

  //         return {
  //           html: result.processedHtml,
  //           hasBlockedImages: result.hasBlockedImages,
  //         };
  //       },
  //     });
  //   };

  //   useEffect(() => {
  //     if (!threadQuery.data?.latest?.id) return;
  //     prefetchEmailContent(threadQuery.data.latest);
  //   }, [threadQuery.data?.latest]);

  const isGroupThread = useMemo(() => {
    if (!threadQuery.data?.latest?.id) return false;
    const totalRecipients = [
      ...(threadQuery.data.latest.to || []),
      ...(threadQuery.data.latest.cc || []),
      ...(threadQuery.data.latest.bcc || []),
    ].length;
    return totalRecipients > 1;
  }, [threadQuery.data]);

  const finalData: IGetThreadResponse | undefined = useMemo(() => {
    if (!threadQuery.data) return undefined;
    return {
      ...threadQuery.data,
      messages: threadQuery.data?.messages.filter((e) => !e.isDraft),
    };
  }, [threadQuery.data]);

  const latestDraft = useMemo(() => {
    if (!threadQuery.data?.latest?.id) return undefined;
    return threadQuery.data.messages.findLast((e) => e.isDraft);
  }, [threadQuery]);

  return { ...threadQuery, data: finalData, isGroupThread, latestDraft };
};
