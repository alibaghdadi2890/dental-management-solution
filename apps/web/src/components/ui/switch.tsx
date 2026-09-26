import { Switch as RadixSwitch } from 'radix-ui';

/** POC switch: 34×20, indigo when on. */
export function Switch({
  checked,
  onCheckedChange,
  label,
  disabled,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <RadixSwitch.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      aria-label={label}
      className="relative h-5 w-[34px] flex-none cursor-pointer rounded-[10px] bg-border-control p-0 data-[state=checked]:bg-primary disabled:cursor-default"
    >
      <RadixSwitch.Thumb className="absolute start-0.5 top-0.5 block size-4 rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,.2)] transition-transform duration-150 data-[state=checked]:translate-x-3.5 rtl:data-[state=checked]:-translate-x-3.5" />
    </RadixSwitch.Root>
  );
}
