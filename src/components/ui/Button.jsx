import { forwardRef } from 'react';
import { joinClasses } from './classNames';
import { LoadingSpinner } from './LoadingIndicator';

const VARIANT_CLASS = {
  primary: 'ui-btn-primary',
  secondary: 'ui-btn-secondary',
  ghost: 'ui-btn-ghost',
  danger: 'ui-btn-danger',
  warning: 'ui-btn-warning'
};

const SIZE_CLASS = {
  sm: 'ui-btn-sm',
  md: 'ui-btn-md',
  lg: 'ui-btn-lg'
};

const Button = forwardRef(function Button(
  {
    as: Component = 'button',
    type,
    variant = 'secondary',
    size = 'md',
    block = false,
    loading = false,
    disabled = false,
    className = '',
    leftIcon = null,
    rightIcon = null,
    children,
    ...props
  },
  ref
) {
  const variantClass = VARIANT_CLASS[variant] || VARIANT_CLASS.secondary;
  const sizeClass = SIZE_CLASS[size] || SIZE_CLASS.md;
  const isButton = Component === 'button';
  const isDisabled = Boolean(disabled || loading);
  const resolvedType = isButton ? type || 'button' : type;

  return (
    <Component
      ref={ref}
      type={resolvedType}
      disabled={isButton ? isDisabled : undefined}
      aria-disabled={!isButton && isDisabled ? 'true' : undefined}
      className={joinClasses('ui-btn', variantClass, sizeClass, block ? 'ui-btn-block' : '', className)}
      {...props}
    >
      {loading ? <LoadingSpinner className={size === 'sm' ? '!h-3.5 !w-3.5 !text-current' : '!text-current'} /> : leftIcon}
      <span>{children}</span>
      {!loading ? rightIcon : null}
    </Component>
  );
});

export default Button;
