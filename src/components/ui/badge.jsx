import * as React from 'react';
import { cva } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-full px-3 py-1 text-xs font-medium transition-colors',
  {
    variants: {
      variant: {
        default: 'bg-teal/12 text-teal border border-teal/25',
        purple: 'bg-purple/12 text-purple border border-purple/25',
        gold: 'bg-gold/12 text-gold border border-gold/25',
        outline: 'border border-black/15 text-text-muted',
        muted: 'bg-black/5 text-text-muted',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

const Badge = React.forwardRef(({ className, variant, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(badgeVariants({ variant }), className)}
    {...props}
  />
));
Badge.displayName = 'Badge';

export { Badge, badgeVariants };
