import React from "react";
import AppSelect from "../../shared/components/AppSelect";

/**
 * Backwards-compatible adapter for the passport-type editor.
 *
 * The shared AppSelect owns the interaction and visual treatment so admin
 * dropdowns behave exactly like every other app dropdown.
 */
function AdminSelectMenu({
  options,
  onChange,
  className = "",
  triggerClassName = "",
  menuClassName = "",
  optionClassName = "",
  ariaLabel,
  ...props
}) {
  return (
    <AppSelect
      {...props}
      options={options}
      onValueChange={onChange}
      className={`${className} ${triggerClassName}`.trim()}
      menuClassName={menuClassName}
      optionClassName={optionClassName}
      aria-label={ariaLabel}
    />
  );
}

export default AdminSelectMenu;
