import { Button } from '@/components/ui/button';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { useQueryState } from 'nuqs';

export default function SortToggle({ className }: { className?: string }) {
  const [sort, setSort] = useQueryState('sort', { defaultValue: 'new' });

  const isOldestFirst = sort === 'old';

  const toggle = () => {
    setSort(isOldestFirst ? 'new' : 'old');
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      className={className}
      onClick={toggle}
      title={isOldestFirst ? 'Sort: Oldest first' : 'Sort: Newest first'}
    >
      {isOldestFirst ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
    </Button>
  );
} 