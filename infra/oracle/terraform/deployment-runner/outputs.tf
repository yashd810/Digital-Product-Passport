output "deployment_runner_instance_id" {
  description = "OCI instance OCID for the dedicated deployment runner"
  value       = oci_core_instance.deployment_runner.id
}

output "deployment_runner_private_ip" {
  description = "Private IP to permit in the DPP frontend and backend SSH rules"
  value       = data.oci_core_vnic.deployment_runner.private_ip_address
}

output "deployment_runner_display_name" {
  description = "OCI display name of the deployment runner"
  value       = oci_core_instance.deployment_runner.display_name
}
