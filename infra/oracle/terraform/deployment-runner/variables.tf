variable "region" {
  type        = string
  description = "OCI region, for example eu-stockholm-1"
}

variable "compartment_ocid" {
  type        = string
  description = "OCI compartment that owns the deployment runner"
}

variable "availability_domain" {
  type        = string
  description = "Availability domain for the deployment runner subnet"
}

variable "subnet_ocid" {
  type        = string
  description = "Private subnet OCID. It must have outbound HTTPS through a NAT or internet gateway."
}

variable "network_security_group_ids" {
  type        = list(string)
  description = "Existing NSGs that permit only the runner's required egress and private SSH to DPP hosts"
}

variable "image_ocid" {
  type        = string
  description = "Approved Linux image OCID compatible with the selected instance shape"
}

variable "shape" {
  type        = string
  description = "Compute shape for the dedicated deployment runner"
}

variable "shape_config" {
  type = object({
    ocpus         = number
    memory_in_gbs = number
  })
  description = "Required for flexible shapes; set null for fixed-shape instances"
  default     = null
}

variable "admin_ssh_public_key" {
  type        = string
  description = "Administrator public key for emergency Bastion-only access"
}

variable "display_name" {
  type        = string
  description = "Display name for the dedicated runner"
  default     = "dpp-production-deployment-runner"
}

variable "hostname_label" {
  type        = string
  description = "DNS-safe hostname label for the runner VNIC"
  default     = "dpp-deploy-runner"
}

variable "runner_user" {
  type        = string
  description = "Unprivileged local user that owns the Actions runner and deployment identity"
  default     = "dpp-deploy"

  validation {
    condition     = can(regex("^[a-z_][a-z0-9_-]*$", var.runner_user))
    error_message = "runner_user must be a valid Linux account name."
  }
}

variable "freeform_tags" {
  type        = map(string)
  description = "Optional OCI freeform tags"
  default     = {}
}
