"use strict";
const pulumi = require("@pulumi/pulumi");
const aws = require("@pulumi/aws");
const {CIDRBlockProvider} = require('./helpers');

const defaultNamespaceConfig = new pulumi.Config();
const awsNamespaceConfig = new pulumi.Config("aws");

// Extract user input variables from config default namespace
const vpcCount = defaultNamespaceConfig.getNumber('vpcCount');
const vpcBaseAddress = defaultNamespaceConfig.require('vpcBaseAddress');
const vpcBitMaskLength = defaultNamespaceConfig.getNumber('vpcBitMaskLength');
const desiredTotalSubnetPairCount = defaultNamespaceConfig.getNumber('desiredTotalSubnetPairCount');
const AMI_ID = defaultNamespaceConfig.require('AMI_ID');
const ec2_key_pair = defaultNamespaceConfig.require('EC2_KEY_PAIR');
const disableApiTermination = defaultNamespaceConfig.require('DISABLE_API_TERMINATION');
const deleteOnTermination = defaultNamespaceConfig.require('DELETE_ON_TERMINATION');
const rootVolumeSize = defaultNamespaceConfig.getNumber('ROOT_VOLUME_SIZE');
const rootVolumeType = defaultNamespaceConfig.require('ROOT_VOLUME_TYPE');
const instanceType = defaultNamespaceConfig.require('INSTANCE_TYPE');

console.log('disableApiTermination = ', disableApiTermination);
console.log('deleteOnTermination = ', deleteOnTermination);
console.log('rootVolumeSize = ', rootVolumeSize);
console.log('rootVolumeType = ', rootVolumeType);
console.log('instanceType = ', instanceType);

// extract inputs from variables in aws namespace
const region = awsNamespaceConfig.get('region');
const profile = awsNamespaceConfig.get('profile');

const queryAvailabilityZonesAndProvisionResources = async(provisionResources) => {
   try{
      const availabilityZonesObj = await aws.getAvailabilityZones({ state: "available" }, { provider: new aws.Provider("myprovider", { region, profile}) });
      console.log(`availabilityZonesObj = `, availabilityZonesObj);
      const availabilityZones = availabilityZonesObj.names;
      let totalSubnetCount = 0
      if(availabilityZones.length >= desiredTotalSubnetPairCount){
         console.log(`inside if statement : availabilityZones.length = ${availabilityZones.length} , desiredTotalSubnetPairCount = ${desiredTotalSubnetPairCount}`);
         totalSubnetCount = 2*desiredTotalSubnetPairCount;
      }else{
         console.log(`inside else statement : availabilityZones.length = ${availabilityZones.length} , desiredTotalSubnetPairCount = ${desiredTotalSubnetPairCount}`);
         totalSubnetCount = 2*availabilityZones.length;
      }
      provisionResources(availabilityZones, totalSubnetCount);
   }catch(e){
      console.log(`Error : ${e}`);
   }
}

const provisionResources = async(availabilityZones, totalSubnetCount) => {

   const totalSubnetBits = Math.ceil(Math.log2(totalSubnetCount));
   console.log(`Math.ceil(Math.log2(2*totalSubnetCount)) = ${Math.ceil(Math.log2(2*totalSubnetCount))}`)
   console.log(`totalSubnetBits = ${totalSubnetBits}`);
   
   for(let i = 0; i < vpcCount; i++){
      const vpc = new aws.ec2.Vpc(`vpc-${(i + 1)}`, {
         enableDnsSupport: true,      // Enable DNS resolution
         enableDnsHostnames: true,    // Enable DNS hostnames
         cidrBlock: CIDRBlockProvider.generateVpcCIDR(vpcBaseAddress, vpcBitMaskLength, i),
         tags: {
            Name: `vpc-${(i+1)}`,
        },
      });
   
      // Create an Internet Gateway for the vpc - '
      const internetGateway = new aws.ec2.InternetGateway(`InternetGateway-vpc-${(i+1)}`, {
         vpcId: vpc.id,
         tags: {
            Name: `InternetGateway-vpc-${(i+1)}`,
         },
      });
   
      // Create public route table in the vpc
      const publicRouteTable = new aws.ec2.RouteTable(`publicRouteTable-vpc-${(i+1)}`, {
         vpcId: vpc.id,
         tags: { Name: `publicRouteTable-vpc-${(i+1)}` },
      });
   
      // Define a public route in the public route table to the Internet Gateway
      const publicInternetGatewayRoute = new aws.ec2.Route(`publicInternetGatewayRoute-vpc-${(i+1)}`, {
         routeTableId: publicRouteTable.id,
         destinationCidrBlock: "0.0.0.0/0",
         gatewayId: internetGateway.id,
      });
   
      // Create private route table in the vpc
      const privateRouteTable = new aws.ec2.RouteTable(`privateRouteTable-vpc-${(i+1)}`, {
         vpcId: vpc.id,
         tags: { Name: `privateRouteTable-vpc-${(i+1)}` },
      });
   
      // create 'publicSubnetsCount' amount of public subnets
      // and attach them to the public route table
      const publicSubnets = [];
      for (let j = 0; j < totalSubnetCount/2; j++) {
         const subnet = new aws.ec2.Subnet(`publicSubnet-${(j+1)}-vpc-${(i+1)}`, {
             cidrBlock: CIDRBlockProvider.generateSubnetCIDR(vpcBaseAddress, vpcBitMaskLength, i, j, totalSubnetBits),
             availabilityZone: availabilityZones[j%availabilityZones.length], // Change the AZ as needed
             vpcId: vpc.id,
             mapPublicIpOnLaunch: true,  // Auto-assign public IP addresses
             tags: { Name: `publicSubnet-${(j+1)}-vpc-${(i+1)}` },
         });
         publicSubnets.push(subnet.id);
         // Associate public subnet with the public route table
         const publicSubnetRouteTableAssociation = new aws.ec2.RouteTableAssociation(`publicSubnetRouteTableAssociation-vpc-${(i + 1)}-subnet-${(j + 1)}`, {
            subnetId: subnet.id,
            routeTableId: publicRouteTable.id,
            tags: {
                Name: `publicSubnetRouteTableAssociation-vpc-${(i + 1)}-subnet-${(j + 1)}`,
            },
        });
      }
   
      // create 'privateSubnetsCount' amount of private subnets
      // and attach them to the private route table
      const privateSubnets = [];
      for (let j = totalSubnetCount/2; j < totalSubnetCount; j++) {
         const subnet = new aws.ec2.Subnet(`privateSubnet-${(j - totalSubnetCount/2 + 1)}-vpc-${(i+1)}`, {
             cidrBlock: CIDRBlockProvider.generateSubnetCIDR(vpcBaseAddress, vpcBitMaskLength, i, j, totalSubnetBits),  // Non-overlapping CIDR blocks for private subnets
             availabilityZone: availabilityZones[(j - totalSubnetCount/2)%availabilityZones.length], // same az as the corresponding public subnet number
             vpcId: vpc.id,
             tags: { Name: `privateSubnet-${(j - totalSubnetCount/2 + 1)}-vpc-${(i+1)}` },
         });
         privateSubnets.push(subnet.id);
         // Associate private subnets with the private route table
         const privateSubnetRouteTableAssociation = new aws.ec2.RouteTableAssociation(`PrivateSubnetRouteTableAssociation-vpc-${(i+1)}-subnet-${(j - totalSubnetCount/2 + 1)}`, {
            subnetId: subnet.id,
            routeTableId: privateRouteTable.id,
            tags: {
                Name: `PrivateSubnetRouteTableAssociation-vpc-${(i+1)}-subnet-${(j - totalSubnetCount/2 + 1)}`,
            },
        });
      }

      const application_ingress_ports = defaultNamespaceConfig.require('APPLICATION_INGRESS_PORTS').split(',');
      const application_ingress_protocol = defaultNamespaceConfig.require('APPLICATION_INGRESS_PROTOCOL');
      const application_ingress_all_ipv4 = defaultNamespaceConfig.require('APPLICATION_INGRESS_ALL_IPV4');
      const application_ingress_all_ipv6 = defaultNamespaceConfig.require('APPLICATION_INGRESS_ALL_IPV6');

      const ingressRules = application_ingress_ports.map(application_ingress_port => ({
         fromPort: application_ingress_port,
         toPort: application_ingress_port,
         protocol: application_ingress_protocol,
         cidrBlocks: [application_ingress_all_ipv4],
         ipv6CidrBlocks: [application_ingress_all_ipv6],
      }));

      const application_egress_ports = defaultNamespaceConfig.require('APPLICATION_EGRESS_PORTS').split(',');
      const application_egress_protocol = defaultNamespaceConfig.require('APPLICATION_EGRESS_PROTOCOL');
      const application_egress_all_ipv4 = defaultNamespaceConfig.require('APPLICATION_EGRESS_ALL_IPV4');
      const application_egress_all_ipv6 = defaultNamespaceConfig.require('APPLICATION_EGRESS_ALL_IPV6');

      const egressRules = application_egress_ports.map(application_egress_port => ({
         fromPort: application_egress_port,
         toPort: application_egress_port,
         protocol: application_egress_protocol,
         cidrBlocks: [application_egress_all_ipv4],
         ipv6CidrBlocks: [application_egress_all_ipv6],
      }));

      const application_security_group_tag = defaultNamespaceConfig.require('APPLICATION_SECURITY_GROUP_TAG');

      const applicationSecurityGroup = new aws.ec2.SecurityGroup(application_security_group_tag, {
         description: "EC2 Security group for the application server",
         vpcId: vpc.id,
         ingress: ingressRules,
         egress: egressRules,
         tags: {
            Name: application_security_group_tag,
         },
      });

      // Create an IAM role with for EC2 to assume
      const cloudwatchAccessRole = new aws.iam.Role('EC2CloudwatchAccess', {
         name: 'EC2CloudwatchAccess', // Specify a custom name for the IAM role
         assumeRolePolicy: JSON.stringify({
            Version: '2012-10-17',
            Statement: [
               {
                     Action: 'sts:AssumeRole',
                     Effect: 'Allow',
                     Principal: {
                        Service: 'ec2.amazonaws.com',
                     },
               },
            ],
         }),
         tags: {
            roleName: 'EC2CloudwatchAccess'
         } 
      });

      // Attach - 'CloudWatchServerAgentPolicy'-  IAM policy to the custom - 'cloudwatchAccessRole' - IAM role created above
      const policyAttachment = new aws.iam.PolicyAttachment('cloudwatch-agent-policy-attachment', {
         roles: [cloudwatchAccessRole.name],
         policyArn: 'arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy',
      }); 

      // Create an instance profile for this role
      const cloudWatchAccessInstanceProfile = new aws.iam.InstanceProfile('EC2CloudwatchAccessInstanceProfile', {
         name: 'EC2CloudwatchAccessInstanceProfile', 
         role: cloudwatchAccessRole.name, // Associate the IAM role with the instance profile
      });

      const database_security_group_tag = defaultNamespaceConfig.require('DATABASE_SECURITY_GROUP_TAG');
      const database_ingress_protocol = defaultNamespaceConfig.require('DATABASE_INGRESS_PROTOCOL');
      const database_ingress_port = defaultNamespaceConfig.getNumber('DATABASE_INGRESS_PORT');

      applicationSecurityGroup.id.apply((id) => console.log(`applicationSecurityGroup.id for use in databaseSecurityGroup = ` + id));

      const databaseSecurityGroup = new aws.ec2.SecurityGroup(database_security_group_tag, {
         description: "EC2 Security group for the database server",
         vpcId: vpc.id,
         ingress: [{
             description: "Ingress rules for TCP Traffic inbound on database server",
             fromPort: database_ingress_port,
             toPort: database_ingress_port,
             protocol: database_ingress_protocol,
             securityGroups : [applicationSecurityGroup.id]
         }],
         tags: {
             Name: database_security_group_tag,
         },
      },{ dependsOn: [applicationSecurityGroup] });

      const database_family = defaultNamespaceConfig.require('DATABASE_FAMILY');
      const rds_parameter_group_tag = defaultNamespaceConfig.require('RDS_PARAMETER_GROUP_TAG');

      const rds_parameter_group = new aws.rds.ParameterGroup(rds_parameter_group_tag, {
         family: database_family,
         tags: {
            Name: rds_parameter_group_tag,
         },
      });

      const rds_subnet_group_tag = defaultNamespaceConfig.require('RDS_SUBNET_GROUP_TAG');
      const rds_subnet_group = new aws.rds.SubnetGroup(rds_subnet_group_tag, {
         subnetIds: [
             privateSubnets[0], // need to make private after dev
             privateSubnets[1]
         ],
         tags: {
             Name: rds_subnet_group_tag,
         },
     });

      const rds_instance_tag = defaultNamespaceConfig.require('RDS_INSTANCE_TAG');
      const db_engine = defaultNamespaceConfig.require('DATABASE_ENGINE');
      const db_engine_version = defaultNamespaceConfig.require('DATABASE_ENGINE_VERSION');
      const db_instance_class = defaultNamespaceConfig.require('DATABASE_INSTANCE_CLASS');
      const database_instance_identifier = defaultNamespaceConfig.require('DATABASE_INSTANCE_IDENTIFIER');
      const database_allocated_storage = defaultNamespaceConfig.getNumber('DATABASE_ALLOCATED_STORAGE');
      const db_username = defaultNamespaceConfig.require('DATABASE_USERNAME');
      const db_password = defaultNamespaceConfig.require('DATABASE_PASSWORD');
      const db_name = defaultNamespaceConfig.require('DATABASE_NAME');

      databaseSecurityGroup.id.apply((id) => console.log(`databaseSecurityGroup.id for use in rds_instance = ` + id));
      rds_parameter_group.name.apply((name) => console.log(`rds_parameter_group.name for use in rds_instance = ` + name));
      rds_subnet_group.name.apply((name) => console.log(`rds_subnet_group.name for use in rds_instance = ` + name));
      
      const rds_instance = new aws.rds.Instance(rds_instance_tag, {
         allocatedStorage: database_allocated_storage,
         dbName: db_name,
         engine: db_engine,
         engineVersion: db_engine_version,
         instanceClass: db_instance_class,
         parameterGroupName: rds_parameter_group.name,
         username:db_username,
         password: db_password,
         dbSubnetGroupName: rds_subnet_group.name,
         multiAz: false,
         identifier: database_instance_identifier,
         publiclyAccessible: false, // need to make false
         skipFinalSnapshot: true,
         vpcSecurityGroupIds: [databaseSecurityGroup.id],
         tags: {
            Name: rds_instance_tag,
         },
      }, { dependsOn: [rds_subnet_group,databaseSecurityGroup,rds_parameter_group] });

      rds_instance.address.apply((address) => console.log(`rds_instance address = ` + address));
      rds_instance.endpoint.apply((endpoint) => console.log(`rds_instance endpoint = ` + endpoint));
   
      const webapp_ec2_tag = defaultNamespaceConfig.require('WEBAPP_EC2_TAG');
      const WEBAPP_PATH = defaultNamespaceConfig.require('WEBAPP_PATH');
      
      const ec2 = new aws.ec2.Instance(webapp_ec2_tag, {
         ami: AMI_ID, // Replace with your desired AMI ID
         instanceType: instanceType,
         vpcSecurityGroupIds: [applicationSecurityGroup.id],
         subnetId: publicSubnets[0], // Choose a public subnet for your instance
         disableApiTermination : disableApiTermination,
         rootBlockDevice: {
            volumeSize: rootVolumeSize,
            volumeType: rootVolumeType,
            deleteOnTermination: deleteOnTermination,
         },
         keyName: ec2_key_pair,
         iamInstanceProfile: cloudWatchAccessInstanceProfile.name,

         userData:pulumi.interpolate`#!/bin/bash

         # Update the .env file with rds host value, user, pass, and db name
         sed -i 's/HOST=.*/HOST=${rds_instance.address}/' ${WEBAPP_PATH}/.env
         # Update the .env file with rds db name value
         sed -i 's/DB=.*/DB=${db_name}/' ${WEBAPP_PATH}/.env
         # Update the .env file with rds username value
         sed -i 's/DB_USERNAME=.*/DB_USERNAME=${db_username}/' ${WEBAPP_PATH}/.env
         # Update the .env file with rds password value
         sed -i 's/DB_PASSWORD=.*/DB_PASSWORD=${db_password}/' ${WEBAPP_PATH}/.env

         # Change the ownership of the .env file to a specific user and group
         sudo chown csye6225:csye6225 ${WEBAPP_PATH}/.env
         # Change the permissions of the .env file
         sudo chmod 755 ${WEBAPP_PATH}/.env

         # Execute cloudwatch agent with config file provisioned in known location through AMI
         sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
            -a fetch-config \
            -m ec2 \
            -c file:/opt/csye6225/webapp/cloudwatch-config.json \
            -s

         `,

         userDataReplaceOnChange: true,

         tags: {
            Name: webapp_ec2_tag,
         },
      },{ dependsOn: [rds_instance] });

      const hostedZoneId = defaultNamespaceConfig.require('HOSTED_ZONE_ID'); // Replace with your hosted zone ID
      const subdomain = defaultNamespaceConfig.require('SUBDOMAIN'); // Replace with the subdomain you want to update
      const recordName = defaultNamespaceConfig.require('A_RECORD_TAG');
      const A_RECORD_TTL = defaultNamespaceConfig.getNumber('A_RECORD_TTL')
      
      console.log(hostedZoneId)
      // Create an A record for the subdomain
      const aRecord = new aws.route53.Record(recordName, {
         name: subdomain,
         zoneId: hostedZoneId,
         type: 'A',
         ttl: A_RECORD_TTL, 
         records: [ec2.publicIp], 
      });

      
   }
}


queryAvailabilityZonesAndProvisionResources(provisionResources);
