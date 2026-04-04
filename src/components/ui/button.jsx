import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal/40 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default:
          'bg-teal text-white hover:bg-teal/90 shadow-teal-glow-sm hover:shadow-teal-glow',
        outline:
          'border border-teal/50 text-teal bg-transparent hover:bg-teal/8 hover:border-teal',
        ghost:
          'text-text-muted hover:text-text-primary hover:bg-black/5',
        gold:
          'bg-gold text-white hover:bg-gold/90 font-semibold shadow-gold-glow',
        purple:
          'border border-purple/50 text-purple bg-transparent hover:bg-purple/8 hover:border-purple',
        dark:
          'bg-text-primary text-white hover:bg-text-primary/90',
      },
      size: {
        default: 'h-10 px-6 py-2',
        sm: 'h-8 px-4 text-xs',
        lg: 'h-12 px-8 text-base',
        xl: 'h-14 px-10 text-lg',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

const Button = React.forwardRef(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';

export { Button, buttonVariants };
