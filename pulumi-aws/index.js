"use strict";
const pulumi = require("@pulumi/pulumi");
const aws = require("@pulumi/aws");
const {CIDRBlockProvider} = require('./helpers');

let config = new pulumi.Config();
// Extract user input variables from config
const vpcCount = config.getNumber('vpcCount');
const vpcBaseAddress = config.require('vpcBaseAddress');
const vpcBitMaskLength = config.getNumber('vpcBitMaskLength');
const availabilityZones = config.getObject("availabilityZones");
const publicSubnetsCount = config.getNumber("publicSubnetsCountPerVpc");
const privateSubnetsCount = config.getNumber('privateSubnetsCountPerVpc');

const totalSubnetBits = Math.ceil(Math.log2(publicSubnetsCount + privateSubnetsCount));

for(let i = 0; i < vpcCount; i++){
   const vpc = new aws.ec2.Vpc(`vpc-${(i + 1)}`, {
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
   for (let j = 0; j < publicSubnetsCount; j++) {
      const subnet = new aws.ec2.Subnet(`publicSubnet-${(j+1)}-vpc-${(i+1)}`, {
          cidrBlock: CIDRBlockProvider.generateSubnetCIDR(vpcBaseAddress, vpcBitMaskLength, i, j, totalSubnetBits),
          availabilityZone: availabilityZones[j%availabilityZones.length], // Change the AZ as needed
          vpcId: vpc.id,
          mapPublicIpOnLaunch: true,  // Auto-assign public IP addresses
          tags: { Name: `publicSubnet-${(j+1)}-vpc-${(i+1)}` },
      });
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
   for (let j = publicSubnetsCount; j < publicSubnetsCount + privateSubnetsCount; j++) {
      const subnet = new aws.ec2.Subnet(`privateSubnet-${(j - publicSubnetsCount + 1)}-vpc-${(i+1)}`, {
          cidrBlock: CIDRBlockProvider.generateSubnetCIDR(vpcBaseAddress, vpcBitMaskLength, i, j, totalSubnetBits),  // Non-overlapping CIDR blocks for private subnets
          availabilityZone: availabilityZones[(j - publicSubnetsCount)%availabilityZones.length], // same az as the corresponding public subnet number
          vpcId: vpc.id,
          tags: { Name: `privateSubnet-${(j - publicSubnetsCount + 1)}-vpc-${(i+1)}` },
      });
      // Associate private subnets with the private route table
      const privateSubnetRouteTableAssociation = new aws.ec2.RouteTableAssociation(`PrivateSubnetRouteTableAssociation-vpc-${(i+1)}-subnet-${(j - publicSubnetsCount + 1)}`, {
         subnetId: subnet.id,
         routeTableId: privateRouteTable.id,
         tags: {
             Name: `PrivateSubnetRouteTableAssociation-vpc-${(i+1)}-subnet-${(j - publicSubnetsCount + 1)}`,
         },
     });
   }
}