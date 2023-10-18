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
const APP_PORT = defaultNamespaceConfig.getNumber('APP_PORT');
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

const provisionResources = (availabilityZones, totalSubnetCount) => {

   const totalSubnetBits = Math.ceil(Math.log2(totalSubnetCount));
   console.log(`Math.ceil(Math.log2(2*totalSubnetCount)) = ${Math.ceil(Math.log2(2*totalSubnetCount))}`)
   console.log(`totalSubnetBits = ${totalSubnetBits}`);
   
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


      const applicationSecurityGroup = new aws.ec2.SecurityGroup("application-security-group", {
         vpcId: vpc.id,
         ingress: [
             {
                 fromPort: 22,
                 toPort: 22,
                 protocol: "tcp",
                 cidrBlocks: ["0.0.0.0/0"],
                 ipv6CidrBlocks: ["::/0"],
             },
             {
                 fromPort: 80,
                 toPort: 80,
                 protocol: "tcp",
                 cidrBlocks: ["0.0.0.0/0"],
                 ipv6CidrBlocks: ["::/0"],
             },
             {
                 fromPort: 443,
                 toPort: 443,
                 protocol: "tcp",
                 cidrBlocks: ["0.0.0.0/0"],
                 ipv6CidrBlocks: ["::/0"],
             },
             {
                 fromPort:  APP_PORT, 
                 toPort:  APP_PORT,   
                 protocol: "tcp",
                 cidrBlocks: ["0.0.0.0/0"],
                 ipv6CidrBlocks: ["::/0"],
             },
         ],
      });
     
      const ec2 = new aws.ec2.Instance("myInstance", {
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
         tags: {
            Name: "WebappEC2",
         },
      });
   }
}


queryAvailabilityZonesAndProvisionResources(provisionResources);
