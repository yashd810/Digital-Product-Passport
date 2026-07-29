terraform {
  required_version = ">= 1.5.0"

  required_providers {
    oci = {
      source  = "oracle/oci"
      version = ">= 5.0.0"
    }
  }
}

provider "oci" {
  region = var.region
}

locals {
  cloud_init = templatefile("${path.module}/../../deployment-runner/cloud-init.yaml.tftpl", {
    runner_user = var.runner_user
  })
}

resource "oci_core_instance" "deployment_runner" {
  availability_domain = var.availability_domain
  compartment_id      = var.compartment_ocid
  display_name        = var.display_name
  shape               = var.shape

  create_vnic_details {
    assign_public_ip = false
    hostname_label   = var.hostname_label
    nsg_ids          = var.network_security_group_ids
    subnet_id        = var.subnet_ocid
  }

  dynamic "shape_config" {
    for_each = var.shape_config == null ? [] : [var.shape_config]

    content {
      memory_in_gbs = shape_config.value.memory_in_gbs
      ocpus         = shape_config.value.ocpus
    }
  }

  metadata = {
    ssh_authorized_keys = var.admin_ssh_public_key
    user_data           = base64encode(local.cloud_init)
  }

  source_details {
    source_id   = var.image_ocid
    source_type = "image"
  }

  freeform_tags = merge({
    managed = "terraform"
    purpose = "dpp-production-deployment-runner"
  }, var.freeform_tags)
}

data "oci_core_vnic_attachments" "deployment_runner" {
  depends_on = [oci_core_instance.deployment_runner]

  compartment_id = var.compartment_ocid
  instance_id    = oci_core_instance.deployment_runner.id
}

data "oci_core_vnic" "deployment_runner" {
  vnic_id = one(data.oci_core_vnic_attachments.deployment_runner.vnic_attachments).vnic_id
}
